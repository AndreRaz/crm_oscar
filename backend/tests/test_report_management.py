"""Generated-report eligibility, durability, repetition, and ownership tests."""
import os

os.environ["DATABASE_URL"] = "sqlite://"

from sqlalchemy import event, select

from app.models import GeneratedReport, Inspection
from tests.conftest import login, make_user
from tests.test_disposition import seed_pending_deviation
from tests.test_inspection import (
    admin_client, inspector_client, record, setup_catalog, start,
)


def seed_conforming(client, db):
    admin_client(client, db)
    setup_catalog(client, chars=("CP-01",))
    client.post("/api/auth/logout")
    inspector_client(client, db)
    start(client, characteristic_ids=(1,))
    record(client, characteristic_id=1, actual=10.0)
    assert client.post("/api/inspections/1/complete").status_code == 200


def test_eligibility_identifies_unmeasured_characteristics_and_pending_deviations(
        db, client):
    from app.services.report_management import check_eligibility

    admin_client(client, db)
    setup_catalog(client)
    client.post("/api/auth/logout")
    inspector_client(client, db)
    start(client)
    record(client, characteristic_id=1, actual=10.0)

    unmeasured = check_eligibility(db, db.get(Inspection, 1))

    assert unmeasured.eligible is False
    assert unmeasured.missing_items == ["Unmeasured characteristic: CP-02"]

    record(client, characteristic_id=2, actual=10.5)
    pending = check_eligibility(db, db.get(Inspection, 1))

    assert pending.eligible is False
    assert pending.missing_items == ["Pending deviation: CP-02"]


def test_metadata_is_inserted_only_after_report_root_fsync(
        db, client, monkeypatch):
    import app.services.report_management as management

    seed_conforming(client, db)
    root = client.app.state.report_root
    events = []
    original_fsync = management._fsync

    def record_fsync(fd):
        result = original_fsync(fd)
        if fd == root.fd:
            events.append("root-fsync")
        return result

    def record_metadata(_session, _flush_context, _instances):
        if any(isinstance(row, GeneratedReport) for row in db.new):
            events.append("metadata")

    monkeypatch.setattr(management, "_fsync", record_fsync)
    monkeypatch.setattr(management, "render_report_pdf", lambda *_: b"%PDF-durable")
    event.listen(db, "before_flush", record_metadata)
    try:
        report = management.generate_report(
            db, db.get(Inspection, 1), db.get(Inspection, 1).inspector_id, root,
        )
    finally:
        event.remove(db, "before_flush", record_metadata)

    assert events == ["root-fsync", "metadata"]
    assert report.file_path.startswith("report_")


def test_metadata_failure_removes_only_newly_published_final(
        db, client, monkeypatch, tmp_path):
    import app.services.report_management as management

    seed_conforming(client, db)
    inspection = db.get(Inspection, 1)
    root = client.app.state.report_root
    monkeypatch.setattr(management, "render_report_pdf", lambda *_: b"%PDF-evidence")
    first = management.generate_report(db, inspection, inspection.inspector_id, root)

    def reject_metadata(_session, _flush_context, _instances):
        if any(isinstance(row, GeneratedReport) and row.file_path != first.file_path
               for row in db.new):
            raise RuntimeError("metadata insert failed")

    event.listen(db, "before_flush", reject_metadata)
    try:
        try:
            management.generate_report(db, inspection, inspection.inspector_id, root)
        except RuntimeError as exc:
            assert str(exc) == "metadata insert failed"
        else:
            raise AssertionError("metadata failure must surface")
    finally:
        event.remove(db, "before_flush", reject_metadata)

    db.expire_all()
    assert [row.file_path for row in db.scalars(select(GeneratedReport)).all()] == [
        first.file_path,
    ]
    assert {path.name for path in tmp_path.iterdir()} == {first.file_path}


def test_repeat_generation_creates_distinct_metadata_rows_and_files(
        db, client, monkeypatch, tmp_path):
    import app.services.report_management as management

    seed_conforming(client, db)
    inspection = db.get(Inspection, 1)
    monkeypatch.setattr(management, "render_report_pdf", lambda *_: b"%PDF-repeatable")

    first = management.generate_report(
        db, inspection, inspection.inspector_id, client.app.state.report_root,
    )
    second = management.generate_report(
        db, inspection, inspection.inspector_id, client.app.state.report_root,
    )

    assert first.id != second.id
    assert first.file_path != second.file_path
    assert db.query(GeneratedReport).count() == 2
    assert {path.name for path in tmp_path.iterdir()} == {
        first.file_path, second.file_path,
    }


def test_report_routes_scope_list_generate_and_download_by_inspection_owner(
        db, client, monkeypatch):
    import app.services.report_management as management

    seed_conforming(client, db)
    monkeypatch.setattr(management, "render_report_pdf", lambda *_: b"%PDF-owned")

    own = client.post("/api/inspections/1/reports")
    assert own.status_code == 201
    report_id = own.json()["id"]
    assert [row["id"] for row in client.get("/api/reports").json()] == [report_id]
    assert client.get(f"/api/reports/{report_id}/download").content == b"%PDF-owned"

    client.post("/api/auth/logout")
    make_user(db, "other")
    login(client, "other")
    assert client.get("/api/reports").json() == []
    assert client.post("/api/inspections/1/reports").status_code == 403
    assert client.get(f"/api/reports/{report_id}/download").status_code == 403

    client.post("/api/auth/logout")
    login(client, "admin")
    assert [row["id"] for row in client.get("/api/reports").json()] == [report_id]
    assert client.post("/api/inspections/1/reports").status_code == 201
    assert client.get(f"/api/reports/{report_id}/download").content == b"%PDF-owned"


def test_generate_route_rejects_unmeasured_and_pending_inspections(db, client):
    admin_client(client, db)
    setup_catalog(client)
    client.post("/api/auth/logout")
    inspector_client(client, db)
    start(client)
    record(client, characteristic_id=1, actual=10.0)

    unmeasured = client.post("/api/inspections/1/reports")
    assert unmeasured.status_code == 409
    assert unmeasured.json()["detail"] == ["Unmeasured characteristic: CP-02"]

    record(client, characteristic_id=2, actual=10.5)
    pending = client.post("/api/inspections/1/reports")
    assert pending.status_code == 409
    assert pending.json()["detail"] == ["Pending deviation: CP-02"]
