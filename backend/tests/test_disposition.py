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


def dispose(client, measurement_id=2, action="accept", text="Use as is"):
    return client.post(f"/api/measurements/{measurement_id}/disposition",
                       json={"action": action, "text": text})


def measurement_of(client, inspection_id=1, characteristic_id=2):
    return next(m for m in
                client.get(f"/api/inspections/{inspection_id}").json()["measurements"]
                if m["characteristic_id"] == characteristic_id)


def annul(client, inspection_id=1, reason="Wrong serial recorded"):
    return client.post(f"/api/inspections/{inspection_id}/annul",
                       json={"reason": reason})


class TestDisposition:
    def test_accept_with_note_audits_and_recomputes_status(self, db, client):
        seed_pending_deviation(client, db)
        response = dispose(client, action="accept", text="Concession OK")
        assert response.status_code == 200
        body = response.json()
        assert body["status"] == "DEVIATION_ACCEPTED"
        assert body["disposition_note"] == "Concession OK"
        assert body["disposition_by"] == 1  # admin
        assert body["disposition_at"] is not None
        assert client.get("/api/inspections/1").json()["status"] == "ACCEPTED_WITH_DEVIATIONS"
        assert client.get("/api/deviations").json()["groups"] == []

    def test_reject_with_reason_sets_rejected(self, db, client):
        seed_pending_deviation(client, db)
        body = dispose(client, action="reject", text="Scrap the part").json()
        assert body["status"] == "REJECTED"
        assert body["disposition_note"] == "Scrap the part"
        assert client.get("/api/inspections/1").json()["status"] == "REJECTED"

    def test_blank_text_returns_422_and_stays_pending(self, db, client):
        seed_pending_deviation(client, db)
        assert dispose(client, text="   ").status_code == 422
        measurement = measurement_of(client)
        assert measurement["status"] == "PENDING"
        assert measurement["disposition_by"] is None
        assert client.get("/api/inspections/1").json()["status"] == "PENDING"

    def test_rejected_worst_status_wins_over_pending_and_accepted(self, db, client):
        admin_client(client, db)
        setup_catalog(client)
        client.post("/api/auth/logout")
        inspector_client(client, db)
        start(client)
        record(client, characteristic_id=1, actual=10.5)  # pending deviation
        record(client, characteristic_id=2, actual=10.6)  # pending deviation
        client.post("/api/inspections/1/complete")
        client.post("/api/auth/logout")
        login(client, "admin")
        dispose(client, measurement_id=1, action="accept", text="Concession A")
        assert client.get("/api/inspections/1").json()["status"] == "PENDING"
        dispose(client, measurement_id=2, action="reject", text="Scrap")
        assert client.get("/api/inspections/1").json()["status"] == "REJECTED"

    def test_inspector_cannot_dispose_and_measurement_remains_pending(self, db, client):
        seed_pending_deviation(client, db)
        client.post("/api/auth/logout")
        login(client, "raul")
        assert dispose(client).status_code == 403
        client.post("/api/auth/logout")
        login(client, "admin")
        assert measurement_of(client)["status"] == "PENDING"

    def test_disposed_measurement_is_immutable(self, db, client):
        seed_pending_deviation(client, db)
        dispose(client, action="accept", text="Concession OK")
        assert dispose(client, action="reject", text="Changed mind").status_code == 409
        measurement = measurement_of(client)
        assert measurement["status"] == "DEVIATION_ACCEPTED"
        assert measurement["disposition_note"] == "Concession OK"

    def test_invalid_action_unknown_measurement_and_unauthenticated(self, db, client):
        assert dispose(client).status_code == 401
        seed_pending_deviation(client, db)
        assert dispose(client, action="maybe").status_code == 422
        assert dispose(client, measurement_id=99).status_code == 404


class TestAnnulment:
    def test_admin_annuls_with_audit_and_record_becomes_terminal(self, db, client):
        seed_pending_deviation(client, db)
        original = measurement_of(client)
        response = annul(client, reason="  Wrong serial recorded  ")
        assert response.status_code == 200
        body = response.json()
        assert body["annulment_reason"] == "Wrong serial recorded"
        assert body["annulled_by"] == 1
        assert body["annulled_at"] is not None
        assert body["completed_at"] is not None
        assert client.get("/api/deviations").json()["groups"] == []
        assert dispose(client, text="Late concession").status_code == 409
        assert measurement_of(client) == original

        first_audit = (body["annulled_at"], body["annulled_by"], body["annulment_reason"])
        assert annul(client, reason="Replace audit").status_code == 409
        stored = client.get("/api/inspections/1").json()
        assert (stored["annulled_at"], stored["annulled_by"],
                stored["annulment_reason"]) == first_audit

    def test_blank_reason_returns_422_and_inspection_stays_pending(self, db, client):
        seed_pending_deviation(client, db)
        assert annul(client, reason="   ").status_code == 422
        inspection = client.get("/api/inspections/1").json()
        assert inspection["annulled_at"] is None
        assert inspection["annulled_by"] is None
        assert inspection["annulment_reason"] is None
        assert len(client.get("/api/deviations").json()["groups"]) == 1

    def test_annulment_is_admin_only_and_requires_completed_inspection(self, db, client):
        seed_pending_deviation(client, db)
        client.post("/api/auth/logout")
        login(client, "raul")
        assert annul(client).status_code == 403
        client.post("/api/auth/logout")
        assert annul(client).status_code == 401

        login(client, "admin")
        assert annul(client, inspection_id=99).status_code == 404
        client.post("/api/auth/logout")
        login(client, "raul")
        start(client, serial="S-002")
        client.post("/api/auth/logout")
        login(client, "admin")
        assert annul(client, inspection_id=2).status_code == 409
