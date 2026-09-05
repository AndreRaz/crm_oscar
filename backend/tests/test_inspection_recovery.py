"""Recovery guards and real two-connection SQLite write serialization."""
from concurrent.futures import ThreadPoolExecutor
from threading import Event

import pytest
from sqlalchemy import create_engine, event, select
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import sessionmaker

from app.models import (
    Base, Characteristic, Deviation, Inspection, Measurement, PartType, User,
    utcnow,
)
from app.services import inspection as service
from app.services.catalog import record_catalog_mutation
from app.services.revision import create_revision
from tests.test_inspection import admin_client, record, setup_catalog, start


@pytest.mark.parametrize("mutation", ["tolerance", "method", "delete", "part"])
def test_catalog_edit_blocks_resume_without_rewriting_evidence(db, client, mutation):
    admin_client(client, db)
    setup_catalog(client)
    started = start(client).json()
    assert record(client, characteristic_id=1, actual=10.2).status_code == 201
    before = client.get("/api/inspections/1").json()
    deviation_count = db.query(Deviation).count()

    if mutation == "delete":
        changed = client.delete("/api/characteristics/2")
        assert changed.status_code == 204
    elif mutation == "part":
        changed = client.patch("/api/part-types/1", json={"part_description": "Updated bracket"})
        assert changed.status_code == 200
    else:
        changes = {"nominal": 20} if mutation == "tolerance" else {"measurement_method": "CMM"}
        changed = client.patch("/api/characteristics/2", json=changes)
        assert changed.status_code == 200

    response = record(client, characteristic_id=2, actual=10.0)

    assert response.status_code == 409
    assert "Part revision changed" in response.json()["detail"]
    assert "saved measurements are preserved" in response.json()["detail"]
    after = client.get("/api/inspections/1").json()
    assert after == before
    assert after["part_revision_id"] == started["part_revision_id"]
    assert db.query(Measurement).count() == 1
    assert db.query(Deviation).count() == deviation_count


def test_restore_as_new_revision_still_blocks_old_inspection(db, client):
    admin_client(client, db)
    setup_catalog(client)
    started = start(client).json()
    revision_no = db.get(PartType, 1).revision_no
    assert client.patch("/api/characteristics/1", json={"nominal": 20}).status_code == 200
    restored = client.post(f"/api/part-types/1/revisions/{revision_no}/restore")
    assert restored.status_code == 200
    assert restored.json()["id"] != started["part_revision_id"]
    assert record(client).status_code == 409
    assert client.get("/api/inspections/1").json()["measurements"] == []
    assert db.query(Deviation).count() == 0


def test_new_inspection_after_edit_uses_its_own_revision(db, client):
    admin_client(client, db)
    setup_catalog(client)
    original = start(client).json()
    assert client.patch("/api/characteristics/1", json={"nominal": 20}).status_code == 200
    current = start(client).json()
    assert current["part_revision_id"] != original["part_revision_id"]
    assert record(client, inspection_id=original["id"]).status_code == 409
    response = record(client, inspection_id=current["id"], actual=20)
    assert response.status_code == 201
    assert response.json()["nominal_snapshot"] == 20
    assert response.json()["status"] == "IN_TOLERANCE"


def test_annulled_incomplete_inspection_cannot_record(db, client):
    admin_client(client, db)
    setup_catalog(client)
    start(client)
    inspection = db.get(Inspection, 1)
    inspection.annulled_at = utcnow()
    inspection.annulment_reason = "Historical incomplete record"
    db.commit()
    db.refresh(inspection)
    before = client.get("/api/inspections/1").json()
    assert before["completed_at"] is None

    response = record(client)

    assert response.status_code == 409
    assert response.json()["detail"] == "Inspection is locked"
    assert client.get("/api/inspections/1").json() == before
    assert db.query(Measurement).count() == 0
    assert db.query(Deviation).count() == 0


@pytest.fixture(params=["delete", "wal"])
def recording_sessions(tmp_path, request):
    engine = create_engine(
        f"sqlite:///{tmp_path / 'recording.db'}",
        connect_args={"check_same_thread": False, "timeout": 2},
    )
    with engine.connect() as connection:
        assert connection.exec_driver_sql(
            f"PRAGMA journal_mode={request.param}",
        ).scalar_one() == request.param
    Base.metadata.create_all(engine)
    sessions = sessionmaker(bind=engine, expire_on_commit=False)
    with sessions() as db:
        user = User(username="inspector", password_hash="unused", role="inspector")
        part = PartType(part_number="LOCK-1", part_description="Locking fixture")
        db.add_all([user, part])
        db.flush()
        db.add(Characteristic(
            part_type_id=part.id, control_plan="CP-1", measurement_method="Caliper",
            tol_type="LIMITS", nominal=10, min_limit=9, max_limit=11,
        ))
        db.flush()
        create_revision(db, part, user.id, increment=False)
        db.commit()
        service.start_inspection(db, part.id, [1], user)
    yield sessions
    engine.dispose()


def edit_catalog(db):
    characteristic = db.get(Characteristic, 1)
    characteristic.nominal = 20
    characteristic.min_limit = 19
    characteristic.max_limit = 21
    record_catalog_mutation(db, db.get(PartType, 1), 1)


def test_catalog_writer_cannot_interleave_revision_check_and_insert(recording_sessions, monkeypatch):
    sessions = recording_sessions
    original_resolve = service.resolve_limits

    def attempt_competing_write(characteristic):
        with sessions() as writer:
            writer.connection().exec_driver_sql("PRAGMA busy_timeout=50")
            with pytest.raises(OperationalError, match="database is locked"):
                edit_catalog(writer)
                writer.commit()
            writer.rollback()
        return original_resolve(characteristic)

    monkeypatch.setattr(service, "resolve_limits", attempt_competing_write)
    with sessions() as db:
        inspection = db.get(Inspection, 1)
        before = dict(db.execute(select(Inspection.__table__)).mappings().one())
        saved = service.record_measurement(db, inspection, 1, 10)
        assert saved.nominal_snapshot == 10
        assert saved.min_limit_snapshot == 9
        assert saved.max_limit_snapshot == 11
        assert dict(db.execute(select(Inspection.__table__)).mappings().one()) == before

    with sessions() as writer:
        edit_catalog(writer)
        writer.commit()
    with sessions() as db:
        assert db.get(PartType, 1).revision_no == 2
        assert db.get(Measurement, 1).nominal_snapshot == 10
        assert db.query(Measurement).count() == 1


def test_catalog_commit_while_record_waits_is_rechecked_with_fresh_rows(recording_sessions):
    sessions = recording_sessions
    attempting_write = Event()

    with sessions() as reader, sessions() as writer:
        inspection = reader.get(Inspection, 1)
        cached_part = reader.get(PartType, 1)
        cached_characteristic = reader.get(Characteristic, 1)
        assert cached_part.revision_no == 1
        assert cached_characteristic.nominal == 10
        edit_catalog(writer)

        def observe_reservation(_connection, _cursor, statement, _parameters, _context, _many):
            if statement.startswith("UPDATE inspections"):
                attempting_write.set()

        connection = reader.connection()
        event.listen(connection, "before_cursor_execute", observe_reservation)
        try:
            with ThreadPoolExecutor(max_workers=1) as executor:
                pending = executor.submit(service.record_measurement, reader, inspection, 1, 10)
                assert attempting_write.wait(timeout=2)
                writer.commit()
                with pytest.raises(service.InspectionError, match="Part revision changed") as blocked:
                    pending.result(timeout=5)
                assert blocked.value.status_code == 409
            assert cached_part.revision_no == 2
            assert reader.query(Measurement).count() == 0
            assert reader.query(Deviation).count() == 0
        finally:
            event.remove(connection, "before_cursor_execute", observe_reservation)
            reader.rollback()
            writer.rollback()


def test_writer_contention_fails_recoverably_without_measurement(recording_sessions):
    sessions = recording_sessions
    with sessions() as reader, sessions() as writer:
        inspection = reader.get(Inspection, 1)
        reader.connection().exec_driver_sql("PRAGMA busy_timeout=50")
        edit_catalog(writer)

        with pytest.raises(service.InspectionError, match="Retry the measurement") as blocked:
            service.record_measurement(reader, inspection, 1, 10)

        assert blocked.value.status_code == 409
        assert not reader.in_transaction()
        writer.rollback()
        assert reader.query(Measurement).count() == 0
        assert reader.query(Deviation).count() == 0
        assert service.record_measurement(reader, inspection, 1, 10).nominal_snapshot == 10
