import os

os.environ["DATABASE_URL"] = "sqlite://"

import pytest
from sqlalchemy import select

from app.models import (
    Deviation, Inspection, Measurement, PartRevision, PartType, Piece,
)
from tests.conftest import login, make_user


def admin_client(client, db):
    make_user(db, "admin", role="admin")
    login(client, "admin")
    return client


def inspector_client(client, db):
    make_user(db, "raul", "inspector")
    login(client, "raul")
    return client


def setup_catalog(client, chars=("CP-01", "CP-02")):
    client.post("/api/part-types", json={
        "part_number": "BRK-001", "part_description": "Bracket"})
    for i, control_plan in enumerate(chars):
        client.post("/api/part-types/1/characteristics", json={
            "control_plan": control_plan, "name": "Diameter", "unit": "mm",
            "tol_type": "SYMMETRIC",
            "measurement_method": f"Caliper method {control_plan}",
            "nominal": 10.0, "tol_plus": 0.1, "sort_order": i})


def start(client, part_type_id=1, characteristic_ids=(1, 2)):
    return client.post("/api/inspections", json={
        "part_type_id": part_type_id,
        "characteristic_ids": list(characteristic_ids)})


def current_revision_id(db, part_type_id=1):
    part_type = db.get(PartType, part_type_id)
    return db.scalar(select(PartRevision).where(
        PartRevision.part_type_id == part_type_id,
        PartRevision.revision_no == part_type.revision_no)).id


class TestStart:
    def test_inspector_starts_inspection_without_serial_and_auto_piece(
            self, db, client):
        admin_client(client, db)
        setup_catalog(client)
        client.post("/api/auth/logout")
        inspector_client(client, db)

        response = start(client)

        assert response.status_code == 201
        body = response.json()
        assert body["status"] == "PENDING"
        assert body["part_type_id"] == 1
        assert "serial" not in body
        assert body["part_revision_id"] == current_revision_id(db)
        assert body["characteristic_ids"] == [1, 2]
        assert body["completed_at"] is None

        pieces = db.scalars(select(Piece)).all()
        assert len(pieces) == 1
        assert pieces[0].part_type_id == 1
        inspection = db.get(Inspection, body["id"])
        assert inspection.piece_id == pieces[0].id
        assert inspection.part_revision_id == body["part_revision_id"]

        fetched = client.get("/api/inspections/1")
        assert fetched.status_code == 200
        assert fetched.json()["status"] == "PENDING"
        assert "serial" not in fetched.json()

    def test_repeated_starts_create_distinct_auto_pieces(self, db, client):
        admin_client(client, db)
        setup_catalog(client)
        client.post("/api/auth/logout")
        inspector_client(client, db)

        first = start(client, characteristic_ids=(1,))
        second = start(client, characteristic_ids=(1,))

        assert first.status_code == 201
        assert second.status_code == 201
        assert first.json()["id"] != second.json()["id"]
        pieces = db.scalars(select(Piece).order_by(Piece.id)).all()
        assert len(pieces) == 2
        assert pieces[0].id != pieces[1].id
        inspections = db.scalars(select(Inspection).order_by(Inspection.id)).all()
        assert [i.piece_id for i in inspections] == [p.id for p in pieces]
        assert {i.part_revision_id for i in inspections} == {
            current_revision_id(db)}

    def test_part_revision_binding_tracks_current_revision_and_is_immutable(
            self, db, client):
        admin_client(client, db)
        setup_catalog(client)
        client.post("/api/auth/logout")
        inspector_client(client, db)

        first = start(client, characteristic_ids=(1,))
        bound_revision = first.json()["part_revision_id"]
        assert bound_revision == current_revision_id(db)

        client.post("/api/auth/logout")
        login(client, "admin")
        edited = client.patch("/api/part-types/1", json={
            "part_description": "Bracket v2"})
        assert edited.status_code == 200
        client.post("/api/auth/logout")
        login(client, "raul")

        second = start(client, characteristic_ids=(1,))
        assert second.json()["part_revision_id"] == current_revision_id(db)
        assert second.json()["part_revision_id"] != bound_revision

        assert client.get(
            "/api/inspections/1").json()["part_revision_id"] == bound_revision

    def test_inactive_part_type_rejected_for_new_inspections(self, db, client):
        admin_client(client, db)
        setup_catalog(client)
        client.patch("/api/part-types/1", json={"active": False})
        client.post("/api/auth/logout")
        inspector_client(client, db)
        assert start(client).status_code == 409

    def test_characteristic_from_other_part_type_rejected(self, db, client):
        admin_client(client, db)
        setup_catalog(client)
        client.post("/api/part-types", json={
            "part_number": "BRK-002", "part_description": "Bracket"})
        client.post("/api/part-types/2/characteristics", json={
            "control_plan": "CP-B1", "measurement_method": "Micrometer",
            "tol_type": "SYMMETRIC", "nominal": 5.0, "tol_plus": 0.2})
        assert start(client, characteristic_ids=(1, 3)).status_code == 422

    def test_unknown_part_type_or_unauthenticated(self, db, client):
        assert start(client).status_code == 401
        admin_client(client, db)
        setup_catalog(client)
        assert start(client, part_type_id=99).status_code == 404

    def test_shared_discovery_is_opt_in_bounded_and_does_not_widen_authority(
            self, db, client):
        admin_client(client, db)
        setup_catalog(client)
        client.post("/api/auth/logout")
        inspector_client(client, db)

        start(client, characteristic_ids=(1,))
        record(client, inspection_id=1, characteristic_id=1, actual=10.0)
        assert client.post("/api/inspections/1/complete").status_code == 200
        start(client, characteristic_ids=(1,))
        record(client, inspection_id=2, characteristic_id=1, actual=10.0)
        assert client.post("/api/inspections/2/complete").status_code == 200
        start(client, characteristic_ids=(1,))
        record(client, inspection_id=3, characteristic_id=1, actual=10.0)

        client.post("/api/auth/logout")
        login(client, "admin")
        assert client.post(
            "/api/inspections/2/annul", json={"reason": "Duplicate record"},
        ).status_code == 200
        client.post("/api/auth/logout")
        other = make_user(db, "diego", role="inspector")
        login(client, other.username)

        owner_scoped = client.get("/api/inspections")
        shared = client.get("/api/inspections?scope=shared")

        assert owner_scoped.status_code == 200
        assert owner_scoped.json() == []
        assert shared.status_code == 200
        rows = shared.json()
        assert [row["id"] for row in rows] == [2, 1]
        assert rows[0]["annulled_at"] is not None
        assert rows[1]["annulled_at"] is None
        assert all(row["completed_at"] is not None for row in rows)
        assert all(row["inspector"] == "raul" for row in rows)
        assert all(len(row["measurements"]) == 1 for row in rows)
        assert all("serial" not in row for row in rows)
        assert set(rows[0]) == {
            "id", "part_type_id", "part_revision_id", "inspector", "status",
            "started_at", "completed_at", "annulled_at", "annulled_by",
            "annulment_reason", "characteristic_ids", "measurements",
        }
        assert set(rows[0]["measurements"][0]) == {
            "id", "characteristic_id", "actual_value", "nominal_snapshot",
            "min_limit_snapshot", "max_limit_snapshot",
            "measurement_method_snapshot", "deviation", "status", "disposition_by",
            "disposition_at", "disposition_note",
        }

        assert client.get("/api/inspections/1").status_code == 403
        assert record(
            client, inspection_id=1, characteristic_id=1, actual=10.0,
        ).status_code == 403
        assert client.get("/api/inspections/1/report.pdf").status_code == 404
        assert client.get("/api/inspections?scope=everything").status_code == 422
        client.post("/api/auth/logout")
        assert client.get("/api/inspections?scope=shared").status_code == 401


def record(client, inspection_id=1, characteristic_id=1, actual=10.05):
    return client.post(f"/api/inspections/{inspection_id}/measurements",
                       json={"characteristic_id": characteristic_id, "actual_value": actual})


class TestRecord:
    def test_in_range_value_is_in_tolerance_with_snapshot(self, db, client):
        admin_client(client, db)
        setup_catalog(client)
        client.post("/api/auth/logout")
        inspector_client(client, db)
        start(client)
        response = record(client, actual=10.05)
        assert response.status_code == 201
        body = response.json()
        assert body["status"] == "IN_TOLERANCE"
        assert body["nominal_snapshot"] == 10.0
        assert body["min_limit_snapshot"] == 9.9
        assert body["max_limit_snapshot"] == 10.1
        assert body["measurement_method_snapshot"] == "Caliper method CP-01"
        assert "lower_limit_snapshot" not in body
        assert "upper_limit_snapshot" not in body
        assert body["deviation"] == pytest.approx(0.05)
        listed = client.get("/api/inspections/1").json()["measurements"]
        assert len(listed) == 1
        assert listed[0]["status"] == "IN_TOLERANCE"
        assert db.query(Deviation).count() == 0

    def test_out_of_range_value_creates_pending_auto_deviation(self, db, client):
        admin_client(client, db)
        setup_catalog(client)
        client.post("/api/auth/logout")
        inspector_client(client, db)
        start(client)
        response = record(client, actual=10.2)
        assert response.status_code == 201
        measurement = response.json()
        assert measurement["status"] == "PENDING"
        deviation = db.scalar(select(Deviation).where(
            Deviation.measurement_id == measurement["id"]))
        assert deviation.origin == "AUTO"
        assert deviation.status == "PENDING"
        assert deviation.description is None
        assert db.query(Deviation).count() == 1

    def test_limits_characteristic_snapshots_canonical_definition(self, db, client):
        admin_client(client, db)
        client.post("/api/part-types", json={
            "part_number": "BRK-001", "part_description": "Bracket"})
        client.post("/api/part-types/1/characteristics", json={
            "control_plan": "CP-L1", "measurement_method": "Bore gauge",
            "tol_type": "LIMITS", "nominal": 10.0,
            "min_limit": 9.5, "max_limit": 10.5})
        client.post("/api/part-types/1/characteristics", json={
            "control_plan": "CP-L2", "measurement_method": "CMM",
            "tol_type": "LIMITS", "nominal": 25.0,
            "min_limit": 24.5, "max_limit": 25.5})
        client.post("/api/auth/logout")
        inspector_client(client, db)
        start(client)
        limits = record(client, characteristic_id=1, actual=10.0).json()
        assert limits["nominal_snapshot"] == 10.0
        assert limits["min_limit_snapshot"] == 9.5
        assert limits["max_limit_snapshot"] == 10.5
        assert "lower_limit_snapshot" not in limits
        assert "upper_limit_snapshot" not in limits
        assert limits["measurement_method_snapshot"] == "Bore gauge"
        assert limits["deviation"] == 0.0
        second = record(client, characteristic_id=2, actual=26.0).json()
        assert second["min_limit_snapshot"] == 24.5
        assert second["max_limit_snapshot"] == 25.5
        assert second["status"] == "PENDING"

    def test_duplicate_characteristic_returns_409(self, db, client):
        admin_client(client, db)
        setup_catalog(client)
        client.post("/api/auth/logout")
        inspector_client(client, db)
        start(client)
        record(client, actual=10.0)
        assert record(client, actual=10.1).status_code == 409

    @pytest.mark.parametrize("invalid", ["ten", "NaN", "Infinity"])
    def test_invalid_numeric_value_rejected_without_recording(self, db, client, invalid):
        admin_client(client, db)
        setup_catalog(client)
        client.post("/api/auth/logout")
        inspector_client(client, db)
        start(client)
        response = client.post("/api/inspections/1/measurements",
                               json={"characteristic_id": 1, "actual_value": invalid})
        assert response.status_code == 422
        assert client.get("/api/inspections/1").json()["measurements"] == []
        assert db.query(Deviation).count() == 0

    def test_snapshot_and_evaluation_survive_characteristic_edit(self, db, client):
        admin_client(client, db)
        setup_catalog(client)
        client.post("/api/auth/logout")
        inspector_client(client, db)
        start(client)
        original = record(client, characteristic_id=1, actual=10.05).json()
        bound_revision = client.get("/api/inspections/1").json()["part_revision_id"]
        client.post("/api/inspections/1/complete")
        client.post("/api/auth/logout")
        login(client, "admin")
        edited = client.patch("/api/characteristics/1", json={
            "measurement_method": "Coordinate measuring machine",
            "nominal": 20.0,
            "tol_plus": 0.5,
        })
        assert edited.status_code == 200
        client.post("/api/auth/logout")
        login(client, "raul")
        detail = client.get("/api/inspections/1").json()
        stored = detail["measurements"]
        first = next(m for m in stored if m["characteristic_id"] == 1)
        assert {
            "nominal": first["nominal_snapshot"],
            "minimum": first["min_limit_snapshot"],
            "maximum": first["max_limit_snapshot"],
            "method": first["measurement_method_snapshot"],
            "status": first["status"],
        } == {
            "nominal": 10.0,
            "minimum": 9.9,
            "maximum": 10.1,
            "method": "Caliper method CP-01",
            "status": "IN_TOLERANCE",
        }
        assert first["status"] == original["status"]
        assert detail["part_revision_id"] == bound_revision

    def test_legacy_null_method_snapshot_is_not_fabricated(self, db, client):
        admin_client(client, db)
        setup_catalog(client)
        client.post("/api/auth/logout")
        inspector_client(client, db)
        start(client)
        db.add(Measurement(
            inspection_id=1,
            characteristic_id=1,
            actual_value=10.0,
            nominal_snapshot=10.0,
            min_limit_snapshot=9.9,
            max_limit_snapshot=10.1,
            measurement_method_snapshot=None,
            deviation=0.0,
            status="IN_TOLERANCE",
        ))
        db.commit()

        stored = client.get("/api/inspections/1").json()["measurements"]

        assert len(stored) == 1
        assert stored[0]["measurement_method_snapshot"] is None
        legacy = db.get(Measurement, stored[0]["id"])
        db.refresh(legacy)
        assert legacy.measurement_method_snapshot is None

    def test_unknown_inspection_404_and_unauthenticated_401(self, db, client):
        admin_client(client, db)
        setup_catalog(client)
        client.post("/api/auth/logout")
        assert record(client).status_code == 401
        inspector_client(client, db)
        assert record(client, inspection_id=99).status_code == 404


class TestComplete:
    def test_all_in_tolerance_completes_conforming(self, db, client):
        admin_client(client, db)
        setup_catalog(client)
        client.post("/api/auth/logout")
        inspector_client(client, db)
        start(client)
        record(client, characteristic_id=1, actual=10.0)
        record(client, characteristic_id=2, actual=9.95)
        response = client.post("/api/inspections/1/complete")
        assert response.status_code == 200
        body = response.json()
        assert body["status"] == "CONFORMING"
        assert body["completed_at"] is not None
        assert client.get("/api/inspections/1").json()["status"] == "CONFORMING"

    def test_out_of_range_measurement_completes_pending(self, db, client):
        admin_client(client, db)
        setup_catalog(client)
        client.post("/api/auth/logout")
        inspector_client(client, db)
        start(client)
        record(client, characteristic_id=1, actual=10.0)
        record(client, characteristic_id=2, actual=10.5)
        body = client.post("/api/inspections/1/complete").json()
        assert body["status"] == "PENDING"

    def test_complete_locks_inspection_against_edits(self, db, client):
        admin_client(client, db)
        setup_catalog(client)
        client.post("/api/auth/logout")
        inspector_client(client, db)
        start(client)
        record(client, characteristic_id=1, actual=10.0)
        client.post("/api/inspections/1/complete")
        assert record(client, characteristic_id=2, actual=10.0).status_code == 409
        assert client.post("/api/inspections/1/complete").status_code == 409

    def test_complete_401_and_404(self, db, client):
        admin_client(client, db)
        setup_catalog(client)
        client.post("/api/auth/logout")
        assert client.post("/api/inspections/1/complete").status_code == 401
        inspector_client(client, db)
        assert client.post("/api/inspections/99/complete").status_code == 404
