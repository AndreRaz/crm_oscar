"""Deviation disposition tests: manual creation, queue, resolution, and annulment."""
import os

os.environ["DATABASE_URL"] = "sqlite://"

import pytest
from sqlalchemy import select

from app.models import Deviation, DeviationAuditEvent, Inspection, Measurement
from app.routers import inspections as inspections_router
from app.services import disposition as disposition_service
from app.services.status import InspectionStatus, MeasurementStatus
from tests.conftest import login, make_user
from tests.test_inspection import (
    admin_client, inspector_client, record, setup_catalog, start,
)


def seed_pending_deviation(client, db):
    """Inspector completes an inspection holding one PENDING deviation; admin logs in."""
    admin_client(client, db)
    setup_catalog(client)
    seed_approved(client)
    client.post("/api/auth/logout")
    inspector_client(client, db)
    start(client)
    record(client, characteristic_id=1, actual=10.0)  # IN_TOLERANCE
    record(client, characteristic_id=2, actual=10.5)  # out of tolerance -> PENDING
    client.post("/api/inspections/1/complete")
    client.post("/api/auth/logout")
    login(client, "admin")


def seed_manual_measurement(client, db, actual=10.0):
    admin_client(client, db)
    setup_catalog(client)
    seed_approved(client)
    client.post("/api/auth/logout")
    inspector_client(client, db)
    start(client)
    response = record(client, actual=actual)
    assert response.status_code == 201
    return response.json()


def create_manual(client, inspection_id=1, measurement_id=1,
                  description="Visual surface defect"):
    return client.post(
        f"/api/inspections/{inspection_id}/measurements/"
        f"{measurement_id}/deviations",
        json={"description": description},
    )


def seed_approved(client, code="AD-001", description="Use as-is"):
    response = client.post(
        "/api/approved-deviations",
        json={"code": code, "description": description},
    )
    assert response.status_code == 201
    return response.json()


def resolution_payload(action="accept", approved_deviation_id=1,
                       rejection_reason="Scrap the part"):
    if action == "accept":
        return {"action": action, "approved_deviation_id": approved_deviation_id}
    return {"action": action, "rejection_reason": rejection_reason}


def resolve_deviation(client, deviation_id=1, action="accept",
                      approved_deviation_id=1, rejection_reason="Scrap the part"):
    return client.post(
        f"/api/deviations/{deviation_id}/resolution",
        json=resolution_payload(action, approved_deviation_id, rejection_reason),
    )


class TestManualDeviationCreation:
    @pytest.mark.parametrize("measurement_status", list(MeasurementStatus))
    def test_inspector_can_create_for_every_dimensional_status_without_status_changes(
            self, db, client, measurement_status):
        actual = 10.2 if measurement_status == MeasurementStatus.PENDING else 10.0
        measurement_body = seed_manual_measurement(client, db, actual=actual)
        measurement = db.get(Measurement, measurement_body["id"])
        inspection = db.get(Inspection, measurement.inspection_id)
        measurement.status = measurement_status
        inspection.status = InspectionStatus.CONFORMING
        db.commit()

        response = create_manual(client, description="  Burr near datum A  ")

        assert response.status_code == 201
        body = response.json()
        assert body["measurement_id"] == measurement.id
        assert body["origin"] == "MANUAL"
        assert body["status"] == "PENDING"
        assert body["description"] == "Burr near datum A"
        assert body["created_by"] == 2
        assert body["created_at"] is not None
        origins = db.scalars(select(Deviation.origin).where(
            Deviation.measurement_id == measurement.id).order_by(Deviation.origin)).all()
        expected_origins = (
            ["AUTO", "MANUAL"]
            if measurement_status == MeasurementStatus.PENDING else ["MANUAL"]
        )
        assert origins == expected_origins
        db.refresh(measurement)
        db.refresh(inspection)
        assert measurement.status == measurement_status
        assert inspection.status == InspectionStatus.CONFORMING

    def test_other_inspector_can_create_for_annulled_measurement_without_authorize(
            self, db, client, monkeypatch):
        measurement_body = seed_manual_measurement(client, db)
        assert client.post("/api/inspections/1/complete").status_code == 200
        client.post("/api/auth/logout")
        login(client, "admin")
        assert annul(client).status_code == 200
        measurement = db.get(Measurement, measurement_body["id"])
        inspection = db.get(Inspection, measurement.inspection_id)
        original_statuses = (measurement.status, inspection.status)
        client.post("/api/auth/logout")
        other = make_user(db, "diego", role="inspector")
        login(client, "diego")

        def fail_authorize(*_args, **_kwargs):
            raise AssertionError("ownership authorize helper must not be called")

        monkeypatch.setattr(inspections_router, "authorize", fail_authorize)
        response = create_manual(client, description="Scratch after handling")

        assert response.status_code == 201
        assert response.json()["created_by"] == other.id
        db.refresh(measurement)
        db.refresh(inspection)
        assert inspection.annulled_at is not None
        assert (measurement.status, inspection.status) == original_statuses

    def test_route_mismatch_and_missing_measurement_reject_without_mutation(
            self, db, client):
        measurement_body = seed_manual_measurement(client, db)
        measurement = db.get(Measurement, measurement_body["id"])
        inspection = db.get(Inspection, measurement.inspection_id)
        original_statuses = (measurement.status, inspection.status)

        mismatch = create_manual(client, inspection_id=99)
        missing = create_manual(client, measurement_id=99)

        assert mismatch.status_code == 409
        assert mismatch.json()["detail"] == "Measurement does not belong to inspection"
        assert missing.status_code == 404
        assert missing.json()["detail"] == "Measurement not found"
        assert db.scalar(select(Deviation).where(
            Deviation.origin == "MANUAL")) is None
        db.refresh(measurement)
        db.refresh(inspection)
        assert (measurement.status, inspection.status) == original_statuses

    @pytest.mark.parametrize("description", ["", "   "])
    def test_blank_description_rejects_without_mutation(
            self, db, client, description):
        measurement_body = seed_manual_measurement(client, db)
        measurement = db.get(Measurement, measurement_body["id"])
        inspection = db.get(Inspection, measurement.inspection_id)
        original_statuses = (measurement.status, inspection.status)

        response = create_manual(client, description=description)

        assert response.status_code == 422
        assert db.query(Deviation).count() == 0
        db.refresh(measurement)
        db.refresh(inspection)
        assert (measurement.status, inspection.status) == original_statuses

    def test_second_pending_manual_rejects_and_preserves_first_and_statuses(
            self, db, client):
        measurement_body = seed_manual_measurement(client, db)
        measurement = db.get(Measurement, measurement_body["id"])
        inspection = db.get(Inspection, measurement.inspection_id)
        original_statuses = (measurement.status, inspection.status)
        first = create_manual(client, description="First observation")

        second = create_manual(client, description="Replacement observation")

        assert first.status_code == 201
        assert second.status_code == 409
        assert second.json()["detail"] == "Pending manual deviation already exists"
        manual_rows = db.scalars(select(Deviation).where(
            Deviation.origin == "MANUAL")).all()
        assert len(manual_rows) == 1
        assert manual_rows[0].description == "First observation"
        db.refresh(measurement)
        db.refresh(inspection)
        assert (measurement.status, inspection.status) == original_statuses

    def test_anonymous_and_admin_requests_reject_without_mutation(self, db, client):
        measurement_body = seed_manual_measurement(client, db)
        measurement = db.get(Measurement, measurement_body["id"])
        inspection = db.get(Inspection, measurement.inspection_id)
        original_statuses = (measurement.status, inspection.status)
        client.post("/api/auth/logout")

        anonymous = create_manual(client)
        login(client, "admin")
        admin = create_manual(client)

        assert anonymous.status_code == 401
        assert admin.status_code == 403
        assert db.query(Deviation).count() == 0
        db.refresh(measurement)
        db.refresh(inspection)
        assert (measurement.status, inspection.status) == original_statuses


class TestQueue:
    def test_queue_groups_pending_deviations_by_inspection(self, db, client):
        seed_pending_deviation(client, db)
        response = client.get("/api/deviations")
        assert response.status_code == 200
        groups = response.json()["groups"]
        assert len(groups) == 1
        inspection = groups[0]["inspection"]
        assert inspection["id"] == 1
        assert inspection["part_number"] == "BRK-001"
        assert "serial" not in inspection
        assert inspection["inspector"] == "raul"
        assert inspection["completed_at"] is not None
        assert inspection["status"] == "PENDING"
        measurements = groups[0]["measurements"]
        assert len(measurements) == 1
        assert measurements[0]["characteristic_id"] == 2
        assert measurements[0]["status"] == "PENDING"
        assert measurements[0]["deviation"] is not None

    def test_queue_orders_groups_newest_first(self, db, client):
        seed_pending_deviation(client, db)
        client.post("/api/auth/logout")
        login(client, "raul")
        start(client)
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

    def test_shared_queue_allows_inspector_but_not_anonymous(self, db, client):
        seed_pending_deviation(client, db)
        client.post("/api/auth/logout")
        login(client, "raul")
        response = client.get("/api/deviations")
        assert response.status_code == 200
        assert response.json()["groups"][0]["deviations"][0]["origin"] == "AUTO"
        client.post("/api/auth/logout")
        assert client.get("/api/deviations").status_code == 401

    def test_shared_queue_groups_auto_and_manual_without_granting_report_access(
            self, db, client):
        seed_manual_measurement(client, db)
        assert create_manual(client, description="Surface scratch").status_code == 201
        record(client, characteristic_id=2, actual=10.5)
        assert client.post("/api/inspections/1/complete").status_code == 200
        client.post("/api/auth/logout")
        other = make_user(db, "diego", role="inspector")
        login(client, other.username)

        response = client.get("/api/deviations")

        assert response.status_code == 200
        groups = response.json()["groups"]
        assert len(groups) == 1
        assert groups[0]["inspection"]["id"] == 1
        assert [row["origin"] for row in groups[0]["deviations"]] == [
            "MANUAL", "AUTO",
        ]
        assert client.get("/api/inspections/1/report.pdf").status_code == 404

    def test_annulled_mixed_group_lists_only_manual_and_auto_stays_terminal(
            self, db, client):
        admin_client(client, db)
        setup_catalog(client)
        client.post("/api/auth/logout")
        inspector_client(client, db)

        start(client, characteristic_ids=(1, 2))
        manual_measurement = record(client, characteristic_id=1, actual=10.0).json()
        auto_measurement = record(client, characteristic_id=2, actual=10.5).json()
        assert create_manual(
            client,
            measurement_id=manual_measurement["id"],
            description="Handling scratch",
        ).status_code == 201
        assert client.post("/api/inspections/1/complete").status_code == 200

        start(client, characteristic_ids=(1,))
        record(client, inspection_id=2, characteristic_id=1, actual=10.5)
        assert client.post("/api/inspections/2/complete").status_code == 200

        client.post("/api/auth/logout")
        login(client, "admin")
        assert annul(client, inspection_id=1).status_code == 200
        assert annul(client, inspection_id=2).status_code == 200

        response = client.get("/api/deviations")

        assert response.status_code == 200
        groups = response.json()["groups"]
        assert [group["inspection"]["id"] for group in groups] == [1]
        assert groups[0]["inspection"]["annulled_at"] is not None
        assert [row["origin"] for row in groups[0]["deviations"]] == ["MANUAL"]
        assert [row["id"] for row in groups[0]["measurements"]] == [
            manual_measurement["id"],
        ]

        auto = db.scalar(select(Deviation).where(
            Deviation.measurement_id == auto_measurement["id"],
            Deviation.origin == "AUTO",
        ))
        auto_status = db.get(Measurement, auto_measurement["id"]).status
        conflict = resolve_deviation(
            client, auto.id, action="reject", rejection_reason="Late rejection",
        )
        assert conflict.status_code == 409
        assert conflict.json()["detail"] == "Annulled inspection is immutable"
        db.refresh(auto)
        assert auto.status == "PENDING"
        assert db.get(Measurement, auto_measurement["id"]).status == auto_status


def dispose(client, measurement_id=2, action="accept", approved_deviation_id=1,
            rejection_reason="Scrap the part"):
    return client.post(f"/api/measurements/{measurement_id}/disposition",
                       json=resolution_payload(
                           action, approved_deviation_id, rejection_reason,
                       ))


def measurement_of(client, inspection_id=1, characteristic_id=2):
    return next(m for m in
                client.get(f"/api/inspections/{inspection_id}").json()["measurements"]
                if m["characteristic_id"] == characteristic_id)


def annul(client, inspection_id=1, reason="Wrong serial recorded"):
    return client.post(f"/api/inspections/{inspection_id}/annul",
                       json={"reason": reason})


class TestDisposition:
    @pytest.mark.parametrize(
        ("action", "rejection_reason", "deviation_status", "measurement_status",
         "inspection_status"),
        [
            ("accept", None, "ACCEPTED",
             "DEVIATION_ACCEPTED", "ACCEPTED_WITH_DEVIATIONS"),
            ("reject", "  Scrap the part  ", "REJECTED", "REJECTED", "REJECTED"),
        ],
    )
    def test_admin_resolves_auto_with_trimmed_audit_and_status_recomputation(
            self, db, client, action, rejection_reason, deviation_status,
            measurement_status, inspection_status):
        seed_pending_deviation(client, db)
        deviation = db.scalar(select(Deviation).where(Deviation.origin == "AUTO"))

        response = resolve_deviation(
            client, deviation.id, action=action,
            rejection_reason=rejection_reason,
        )

        assert response.status_code == 200
        body = response.json()
        assert body["id"] == deviation.id
        assert body["status"] == deviation_status
        assert body["rejection_reason"] == (
            rejection_reason.strip() if rejection_reason else None
        )
        assert body["approved_deviation_id"] == (1 if action == "accept" else None)
        assert body["resolved_by"] == 1
        assert body["resolved_at"] is not None
        assert measurement_of(client)["status"] == measurement_status
        assert client.get("/api/inspections/1").json()["status"] == inspection_status

    @pytest.mark.parametrize("reason", ["", "   "])
    def test_blank_rejection_reason_is_rejected_and_deviation_stays_pending(
            self, db, client, reason):
        seed_pending_deviation(client, db)
        deviation = db.scalar(select(Deviation).where(Deviation.origin == "AUTO"))

        response = resolve_deviation(
            client, deviation.id, action="reject", rejection_reason=reason,
        )

        assert response.status_code == 422
        db.refresh(deviation)
        assert deviation.status == "PENDING"
        assert deviation.resolution_text is None
        assert deviation.resolved_by is None
        assert deviation.resolved_at is None
        assert measurement_of(client)["status"] == "PENDING"
        assert client.get("/api/inspections/1").json()["status"] == "PENDING"

    def test_free_text_acceptance_and_missing_catalog_selection_are_rejected(
            self, db, client):
        seed_pending_deviation(client, db)
        deviation = db.scalar(select(Deviation).where(Deviation.origin == "AUTO"))

        free_text = client.post(
            f"/api/deviations/{deviation.id}/resolution",
            json={"action": "accept", "text": "Use as-is"},
        )
        missing = client.post(
            f"/api/deviations/{deviation.id}/resolution",
            json={"action": "accept"},
        )

        assert free_text.status_code == 422
        assert missing.status_code == 422
        db.refresh(deviation)
        assert deviation.status == "PENDING"
        assert db.query(DeviationAuditEvent).count() == 0

    def test_inactive_catalog_entry_cannot_resolve_deviation(self, db, client):
        seed_pending_deviation(client, db)
        deviation = db.scalar(select(Deviation).where(Deviation.origin == "AUTO"))
        client.patch("/api/approved-deviations/1", json={"active": False})

        response = resolve_deviation(client, deviation.id)

        assert response.status_code == 422
        assert response.json()["detail"] == "Approved deviation is inactive"
        db.refresh(deviation)
        assert deviation.status == "PENDING"

    def test_manual_resolution_is_audited_without_dimensional_status_changes(
            self, db, client):
        seed_manual_measurement(client, db)
        assert create_manual(client, description="Surface scratch").status_code == 201
        assert client.post("/api/inspections/1/complete").status_code == 200
        measurement = db.get(Measurement, 1)
        inspection = db.get(Inspection, 1)
        original_statuses = (measurement.status, inspection.status)
        deviation = db.scalar(select(Deviation).where(Deviation.origin == "MANUAL"))
        client.post("/api/auth/logout")
        login(client, "admin")

        response = resolve_deviation(
            client, deviation.id, action="accept",
        )

        assert response.status_code == 200
        assert response.json()["status"] == "ACCEPTED"
        assert response.json()["approved_deviation_code_snapshot"] == "AD-001"
        assert response.json()["rejection_reason"] is None
        assert response.json()["resolved_by"] == 1
        assert response.json()["resolved_at"] is not None
        db.refresh(measurement)
        db.refresh(inspection)
        assert (measurement.status, inspection.status) == original_statuses

    def test_cross_owner_annulled_manual_complete_journey_is_status_neutral(
            self, db, client):
        measurement_body = seed_manual_measurement(client, db)
        assert client.post("/api/inspections/1/complete").status_code == 200
        client.post("/api/auth/logout")
        login(client, "admin")
        assert annul(client).status_code == 200
        measurement = db.get(Measurement, measurement_body["id"])
        inspection = db.get(Inspection, measurement.inspection_id)
        original_statuses = (measurement.status, inspection.status)

        client.post("/api/auth/logout")
        other = make_user(db, "diego", role="inspector")
        login(client, other.username)
        created = create_manual(
            client,
            description="Scratch found during historical review",
        )
        assert created.status_code == 201
        deviation_id = created.json()["id"]

        listed = client.get("/api/deviations")
        assert listed.status_code == 200
        groups = listed.json()["groups"]
        assert len(groups) == 1
        assert groups[0]["inspection"]["id"] == inspection.id
        assert groups[0]["inspection"]["annulled_at"] is not None
        assert [row["id"] for row in groups[0]["deviations"]] == [deviation_id]
        assert groups[0]["deviations"][0]["origin"] == "MANUAL"

        client.post("/api/auth/logout")
        login(client, "admin")
        resolved = resolve_deviation(
            client,
            deviation_id,
            action="accept",
        )

        assert resolved.status_code == 200
        body = resolved.json()
        assert body["status"] == "ACCEPTED"
        assert body["approved_deviation_code_snapshot"] == "AD-001"
        assert body["rejection_reason"] is None
        assert body["resolved_by"] == 1
        assert body["resolved_at"] is not None
        assert client.get("/api/deviations").json()["groups"] == []
        db.refresh(measurement)
        db.refresh(inspection)
        assert (measurement.status, inspection.status) == original_statuses

    def test_inspector_cannot_resolve_and_deviation_remains_pending(self, db, client):
        seed_pending_deviation(client, db)
        deviation = db.scalar(select(Deviation).where(Deviation.origin == "AUTO"))
        client.post("/api/auth/logout")
        login(client, "raul")

        response = resolve_deviation(client, deviation.id)

        assert response.status_code == 403
        db.refresh(deviation)
        assert deviation.status == "PENDING"
        assert measurement_of(client)["status"] == "PENDING"

    def test_legacy_endpoint_delegates_to_unified_resolution_service(
            self, db, client, monkeypatch):
        seed_pending_deviation(client, db)
        deviation = db.scalar(select(Deviation).where(Deviation.origin == "AUTO"))
        calls = []

        def resolve_spy(session, selected, action, user,
                        approved_deviation_id=None, rejection_reason=None):
            calls.append((
                session, selected.id, action, user.id,
                approved_deviation_id, rejection_reason,
            ))
            selected.status = "ACCEPTED"
            selected.approved_deviation_id = approved_deviation_id
            selected.approved_deviation_code_snapshot = "AD-001"
            selected.approved_deviation_description_snapshot = "Use as-is"
            selected.resolved_by = user.id
            selected.resolved_at = selected.created_at
            measurement = session.get(Measurement, selected.measurement_id)
            measurement.status = MeasurementStatus.DEVIATION_ACCEPTED
            return selected

        monkeypatch.setattr(
            disposition_service, "resolve_deviation", resolve_spy, raising=False,
        )

        response = dispose(client, action="accept", approved_deviation_id=1)

        assert response.status_code == 200
        assert calls == [(db, deviation.id, "accept", 1, 1, None)]
        assert response.json()["status"] == "DEVIATION_ACCEPTED"

    def test_accept_with_note_audits_and_recomputes_status(self, db, client):
        seed_pending_deviation(client, db)
        response = dispose(client, action="accept")
        assert response.status_code == 200
        body = response.json()
        assert body["status"] == "DEVIATION_ACCEPTED"
        assert body["disposition_note"] == "AD-001: Use as-is"
        assert body["disposition_by"] == 1  # admin
        assert body["disposition_at"] is not None
        assert client.get("/api/inspections/1").json()["status"] == "ACCEPTED_WITH_DEVIATIONS"
        assert client.get("/api/deviations").json()["groups"] == []

    def test_reject_with_reason_sets_rejected(self, db, client):
        seed_pending_deviation(client, db)
        body = dispose(
            client, action="reject", rejection_reason="Scrap the part",
        ).json()
        assert body["status"] == "REJECTED"
        assert body["disposition_note"] == "Scrap the part"
        assert client.get("/api/inspections/1").json()["status"] == "REJECTED"

    def test_blank_text_returns_422_and_stays_pending(self, db, client):
        seed_pending_deviation(client, db)
        assert dispose(
            client, action="reject", rejection_reason="   ",
        ).status_code == 422
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
        dispose(client, measurement_id=1, action="accept")
        assert client.get("/api/inspections/1").json()["status"] == "PENDING"
        dispose(client, measurement_id=2, action="reject", rejection_reason="Scrap")
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
        dispose(client, action="accept")
        assert dispose(
            client, action="reject", rejection_reason="Changed mind",
        ).status_code == 409
        measurement = measurement_of(client)
        assert measurement["status"] == "DEVIATION_ACCEPTED"
        assert measurement["disposition_note"] == "AD-001: Use as-is"

    def test_invalid_action_unknown_measurement_and_unauthenticated(self, db, client):
        assert dispose(client).status_code == 401
        seed_pending_deviation(client, db)
        assert client.post(
            "/api/measurements/2/disposition", json={"action": "maybe"},
        ).status_code == 422
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
        assert dispose(client).status_code == 409
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
        start(client)
        client.post("/api/auth/logout")
        login(client, "admin")
        assert annul(client, inspection_id=2).status_code == 409
