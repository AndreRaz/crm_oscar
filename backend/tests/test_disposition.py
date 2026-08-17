"""Deviation disposition tests: queue, accept/reject, annulment (spec: deviation-disposition)."""
from tests.conftest import login, make_user
from tests.test_inspection import (
    admin_client, inspector_client, record, setup_catalog, start,
)


def seed_pending_deviation(client, db, serial="S-001"):
    """Inspector completes an inspection holding one PENDING deviation; admin logs in."""
    admin_client(client, db)
    setup_catalog(client)
    client.post("/api/auth/logout")
    inspector_client(client, db)
    start(client, serial=serial)
    record(client, characteristic_id=1, actual=10.0)  # IN_TOLERANCE
    record(client, characteristic_id=2, actual=10.5)  # out of tolerance -> PENDING
    client.post("/api/inspections/1/complete")
    client.post("/api/auth/logout")
    login(client, "admin")


class TestQueue:
    def test_queue_groups_pending_deviations_by_inspection(self, db, client):
        seed_pending_deviation(client, db)
        response = client.get("/api/deviations")
        assert response.status_code == 200
        groups = response.json()["groups"]
        assert len(groups) == 1
        inspection = groups[0]["inspection"]
        assert inspection["id"] == 1
        assert inspection["part_type_code"] == "BRK-001"
        assert inspection["serial"] == "S-001"
        assert inspection["inspector"] == "raul"
        assert inspection["completed_at"] is not None
        assert inspection["status"] == "PENDING"
        measurements = groups[0]["measurements"]
        assert len(measurements) == 1
        assert measurements[0]["characteristic_id"] == 2
        assert measurements[0]["status"] == "PENDING"
        assert measurements[0]["deviation"] is not None

    def test_queue_orders_groups_newest_first(self, db, client):
        seed_pending_deviation(client, db, serial="S-001")
        client.post("/api/auth/logout")
        login(client, "raul")
        start(client, serial="S-002")
        record(client, inspection_id=2, characteristic_id=1, actual=10.5)
        client.post("/api/inspections/2/complete")
        client.post("/api/auth/logout")
        login(client, "admin")
        groups = client.get("/api/deviations").json()["groups"]
        assert [g["inspection"]["id"] for g in groups] == [2, 1]

    def test_conforming_inspection_not_queued(self, db, client):
        admin_client(client, db)
        setup_catalog(client)
        client.post("/api/auth/logout")
        inspector_client(client, db)
        start(client)
        record(client, characteristic_id=1, actual=10.0)
        record(client, characteristic_id=2, actual=10.0)
        client.post("/api/inspections/1/complete")
        client.post("/api/auth/logout")
        login(client, "admin")
        assert client.get("/api/deviations").json()["groups"] == []

    def test_queue_requires_admin(self, db, client):
        seed_pending_deviation(client, db)
        client.post("/api/auth/logout")
        login(client, "raul")
        assert client.get("/api/deviations").status_code == 403
        client.post("/api/auth/logout")
        assert client.get("/api/deviations").status_code == 401
