"""Deviation disposition service: pending queue, accept/reject, audit (design ADR-5)."""
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Inspection, Measurement, PartType, Piece, User, utcnow
from app.schemas import MeasurementOut, QueueInspectionOut
from app.services.status import InspectionStatus, MeasurementStatus, worst_of


class DispositionError(Exception):
    """Business rule violation; maps to an HTTP status in the router."""

    def __init__(self, status_code: int, detail: str):
        self.status_code = status_code
        self.detail = detail
        super().__init__(detail)


def pending_queue(db: Session) -> list[dict]:
    """Group PENDING deviations by completed, non-annulled inspection, newest first."""
    inspections = db.scalars(
        select(Inspection).where(
            Inspection.status == InspectionStatus.PENDING,
            Inspection.completed_at.is_not(None),
            Inspection.annulled_at.is_(None),
        ).order_by(Inspection.completed_at.desc(), Inspection.id.desc())
    ).all()
    groups = []
    for inspection in inspections:
        piece = db.get(Piece, inspection.piece_id)
        part_type = db.get(PartType, piece.part_type_id)
        measurements = db.scalars(select(Measurement).where(
            Measurement.inspection_id == inspection.id,
            Measurement.status == MeasurementStatus.PENDING,
        ).order_by(Measurement.id)).all()
        groups.append({
            "inspection": QueueInspectionOut(
                id=inspection.id, part_type_code=part_type.code,
                serial=piece.serial,
                inspector=db.get(User, inspection.inspector_id).username,
                completed_at=inspection.completed_at, status=inspection.status),
            "measurements": [MeasurementOut.model_validate(m) for m in measurements],
        })
    return groups


def dispose_measurement(db: Session, measurement: Measurement, action: str,
                        text: str, user: User) -> Measurement:
    """Apply an admin disposition and re-derive the inspection worst-of status (ADR-5)."""
    if not text.strip():
        raise DispositionError(422, "Disposition note or reason is required")
    if measurement.status != MeasurementStatus.PENDING:
        raise DispositionError(409, "Measurement is no longer pending")
    measurement.status = (
        MeasurementStatus.DEVIATION_ACCEPTED if action == "accept"
        else MeasurementStatus.REJECTED)
    measurement.disposition_by = user.id
    measurement.disposition_at = utcnow()
    measurement.disposition_note = text.strip()
    inspection = db.get(Inspection, measurement.inspection_id)
    inspection.status = worst_of(db.scalars(select(Measurement.status).where(
        Measurement.inspection_id == inspection.id)).all())
    db.commit()
    db.refresh(measurement)
    return measurement
