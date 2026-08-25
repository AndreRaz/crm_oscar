"""Deviation resolution audit integrity tests."""
import os

os.environ["DATABASE_URL"] = "sqlite://"

import pytest
from sqlalchemy import select, text
from sqlalchemy.exc import IntegrityError

from app.db import _create_audit_triggers
from app.models import ApprovedDeviation, Deviation, DeviationAuditEvent
from tests.test_disposition import resolve_deviation, seed_pending_deviation


def resolve_accepted(db, client):
    seed_pending_deviation(client, db)
    deviation = db.scalar(select(Deviation).where(Deviation.origin == "AUTO"))
    response = resolve_deviation(client, deviation.id, action="accept")
    assert response.status_code == 200
    return deviation, db.scalar(select(DeviationAuditEvent))


class TestDeviationAuditEvents:
    def test_acceptance_appends_immutable_catalog_snapshot(self, db, client):
        deviation, event = resolve_accepted(db, client)

        assert event.deviation_id == deviation.id
        assert event.action == "ACCEPTED"
        assert event.actor_id == 1
        assert event.approved_deviation_id == 1
        assert event.approved_deviation_code_snapshot == "AD-001"
        assert event.approved_deviation_description_snapshot == "Use as-is"
        assert event.rejection_reason is None
        assert event.created_at is not None

    def test_rejection_appends_reason_without_catalog_snapshot(self, db, client):
        seed_pending_deviation(client, db)
        deviation = db.scalar(select(Deviation).where(Deviation.origin == "AUTO"))

        response = resolve_deviation(
            client, deviation.id, action="reject", rejection_reason="  Scrap  ",
        )
        event = db.scalar(select(DeviationAuditEvent))

        assert response.status_code == 200
        assert event.action == "REJECTED"
        assert event.rejection_reason == "Scrap"
        assert event.approved_deviation_id is None
        assert event.approved_deviation_code_snapshot is None

    @pytest.mark.parametrize(
        "statement",
        [
            "UPDATE deviation_audit_events SET action='REJECTED' WHERE id=1",
            "DELETE FROM deviation_audit_events WHERE id=1",
        ],
    )
    def test_database_triggers_abort_raw_update_and_delete(self, db, client, statement):
        _, event = resolve_accepted(db, client)
        _create_audit_triggers(db.connection())
        db.commit()

        with pytest.raises(IntegrityError, match="append-only"):
            db.execute(text(statement))
            db.commit()
        db.rollback()

        preserved = db.get(DeviationAuditEvent, event.id)
        assert preserved.action == "ACCEPTED"
        assert preserved.approved_deviation_code_snapshot == "AD-001"

    def test_restrict_foreign_keys_preserve_audit_references(self, db, client):
        db.execute(text("PRAGMA foreign_keys=ON"))
        deviation, event = resolve_accepted(db, client)
        approved = db.get(ApprovedDeviation, event.approved_deviation_id)

        with pytest.raises(IntegrityError, match="FOREIGN KEY"):
            db.delete(approved)
            db.commit()
        db.rollback()
        with pytest.raises(IntegrityError, match="FOREIGN KEY"):
            db.delete(deviation)
            db.commit()
        db.rollback()

        assert db.get(ApprovedDeviation, approved.id).code == "AD-001"
        assert db.get(DeviationAuditEvent, event.id).deviation_id == deviation.id
