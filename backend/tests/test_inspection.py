from tests.conftest import login, make_user

import pytest


def admin_client(client, db):
    make_user(db, "admin", role="admin")
    login(client, "admin")
    return client


def inspector_client(client, db):
    make_user(db, "raul", "inspector")
    login(client, "raul")
    return client


def setup_catalog(client, chars=("A1", "A2")):
    client.post("/api/part-types", json={"code": "BRK-001"})
    for i, code in enumerate(chars):
        client.post("/api/part-types/1/characteristics", json={
            "code": code, "name": "Diameter", "unit": "mm", "tol_type": "SYMMETRIC",
            "nominal": 10.0, "tol_plus": 0.1, "sort_order": i})


def start(client, serial="S-001", part_type_id=1, characteristic_ids=(1, 2)):
    return client.post("/api/inspections", json={
        "part_type_id": part_type_id, "serial": serial,
        "characteristic_ids": list(characteristic_ids)})


class TestStart:
    def test_inspector_starts_valid_inspection(self, db, client):
        admin_client(client, db)
        setup_catalog(client)
        client.post("/api/auth/logout")
        inspector_client(client, db)
        response = start(client)
        assert response.status_code == 201
        body = response.json()
        assert body["status"] == "PENDING"
        assert body["part_type_id"] == 1
        assert body["serial"] == "S-001"
        assert body["characteristic_ids"] == [1, 2]
        assert body["completed_at"] is None
        fetched = client.get("/api/inspections/1")
        assert fetched.status_code == 200
        assert fetched.json()["status"] == "PENDING"

    def test_duplicate_serial_within_part_type_returns_409(self, db, client):
        admin_client(client, db)
        setup_catalog(client)
        start(client, "S-001")
        assert start(client, "S-001").status_code == 409

    def test_same_serial_allowed_on_other_part_type(self, db, client):
        admin_client(client, db)
        setup_catalog(client)
        client.post("/api/part-types", json={"code": "BRK-002"})
        client.post("/api/part-types/2/characteristics", json={
            "code": "B1", "tol_type": "SYMMETRIC", "nominal": 5.0, "tol_plus": 0.2})
        start(client, "S-001")
        response = start(client, "S-001", part_type_id=2, characteristic_ids=(3,))
        assert response.status_code == 201
        assert response.json()["part_type_id"] == 2

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
        client.post("/api/part-types", json={"code": "BRK-002"})
        client.post("/api/part-types/2/characteristics", json={
            "code": "B1", "tol_type": "SYMMETRIC", "nominal": 5.0, "tol_plus": 0.2})
        assert start(client, characteristic_ids=(1, 3)).status_code == 422

    def test_unknown_part_type_or_unauthenticated(self, db, client):
        assert start(client).status_code == 401
        admin_client(client, db)
        setup_catalog(client)
        assert start(client, part_type_id=99).status_code == 404


def record(client, inspection_id=1, characteristic_id=1, actual=10.05):
    return client.post(f"/api/inspections/{inspection_id}/measurements",
                       json={"characteristic_id": characteristic_id, "actual_value": actual})


def start_default(client, serial="S-001"):
    return start(client, serial=serial)


class TestRecord:
    def test_in_range_value_is_in_tolerance_with_snapshot(self, db, client):
        admin_client(client, db)
        setup_catalog(client)
        client.post("/api/auth/logout")
        inspector_client(client, db)
        start_default(client)
        response = record(client, actual=10.05)
        assert response.status_code == 201
        body = response.json()
        assert body["status"] == "IN_TOLERANCE"
        assert body["nominal_snapshot"] == 10.0
        assert body["lower_limit_snapshot"] == 9.9
        assert body["upper_limit_snapshot"] == 10.1
        assert body["deviation"] == pytest.approx(0.05)
        listed = client.get("/api/inspections/1").json()["measurements"]
        assert len(listed) == 1
        assert listed[0]["status"] == "IN_TOLERANCE"

    def test_out_of_range_value_is_pending(self, db, client):
        admin_client(client, db)
        setup_catalog(client)
        client.post("/api/auth/logout")
        inspector_client(client, db)
        start_default(client)
        assert record(client, actual=10.2).json()["status"] == "PENDING"

    def test_limits_characteristic_snapshots_bounds_and_unilateral(self, db, client):
        admin_client(client, db)
        client.post("/api/part-types", json={"code": "BRK-001"})
        client.post("/api/part-types/1/characteristics", json={
            "code": "L1", "tol_type": "LIMITS", "min_limit": 9.5, "max_limit": 10.5})
        client.post("/api/part-types/1/characteristics", json={
            "code": "L2", "tol_type": "LIMITS", "max_limit": 25.0})
        client.post("/api/auth/logout")
        inspector_client(client, db)
        start(client, characteristic_ids=(1, 2))
        limits = record(client, characteristic_id=1, actual=10.0).json()
        assert limits["lower_limit_snapshot"] == 9.5
        assert limits["upper_limit_snapshot"] == 10.5
        assert limits["deviation"] is None
        unilateral = record(client, characteristic_id=2, actual=30.0).json()
        assert unilateral["lower_limit_snapshot"] is None
        assert unilateral["upper_limit_snapshot"] == 25.0
        assert unilateral["status"] == "PENDING"

    def test_duplicate_characteristic_returns_409(self, db, client):
        admin_client(client, db)
        setup_catalog(client)
        client.post("/api/auth/logout")
        inspector_client(client, db)
        start_default(client)
        record(client, actual=10.0)
        assert record(client, actual=10.1).status_code == 409

    def test_non_numeric_value_rejected_422(self, db, client):
        admin_client(client, db)
        setup_catalog(client)
        client.post("/api/auth/logout")
        inspector_client(client, db)
        start_default(client)
        response = client.post("/api/inspections/1/measurements",
                               json={"characteristic_id": 1, "actual_value": "ten"})
        assert response.status_code == 422
        assert client.get("/api/inspections/1").json()["measurements"] == []

    def test_snapshot_survives_characteristic_edit(self, db, client):
        admin_client(client, db)
        setup_catalog(client)
        client.post("/api/auth/logout")
        inspector_client(client, db)
        start_default(client)
        record(client, characteristic_id=1, actual=10.05)
        client.post("/api/auth/logout")
        login(client, "admin")
        client.patch("/api/characteristics/2", json={"nominal": 20.0, "tol_plus": 0.5})
        client.post("/api/auth/logout")
        login(client, "raul")
        fresh = record(client, characteristic_id=2, actual=20.1).json()
        assert fresh["nominal_snapshot"] == 20.0
        assert fresh["lower_limit_snapshot"] == 19.5
        stored = client.get("/api/inspections/1").json()["measurements"]
        first = next(m for m in stored if m["characteristic_id"] == 1)
        assert first["nominal_snapshot"] == 10.0
        assert first["status"] == "IN_TOLERANCE"

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
        start_default(client)
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
        start_default(client)
        record(client, characteristic_id=1, actual=10.0)
        record(client, characteristic_id=2, actual=10.5)
        body = client.post("/api/inspections/1/complete").json()
        assert body["status"] == "PENDING"

    def test_complete_locks_inspection_against_edits(self, db, client):
        admin_client(client, db)
        setup_catalog(client)
        client.post("/api/auth/logout")
        inspector_client(client, db)
        start_default(client)
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
