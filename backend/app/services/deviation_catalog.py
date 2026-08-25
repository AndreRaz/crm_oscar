"""Approved-deviation catalog and transactional resolution service."""
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models import (
    ApprovedDeviation, Deviation, DeviationAuditEvent, Inspection, Measurement,
    User, utcnow,
)
from app.services.status import MeasurementStatus, worst_of


class DeviationCatalogError(Exception):
    def __init__(self, status_code: int, detail: str):
        self.status_code = status_code
        self.detail = detail
        super().__init__(detail)


def list_entries(db: Session, active_only: bool = False) -> list[ApprovedDeviation]:
    query = select(ApprovedDeviation)
    if active_only:
        query = query.where(ApprovedDeviation.active.is_(True))
    return list(db.scalars(query.order_by(ApprovedDeviation.code, ApprovedDeviation.id)))


def create_entry(db: Session, code: str, description: str) -> ApprovedDeviation:
    entry = ApprovedDeviation(
        code=code.strip(), description=description.strip(), active=True,
    )
    db.add(entry)
    _commit_catalog_change(db, "Approved deviation code already exists")
    db.refresh(entry)
    return entry


def update_entry(db: Session, entry: ApprovedDeviation, **changes) -> ApprovedDeviation:
    for field in ("code", "description"):
        value = changes.get(field)
        if value is not None:
            setattr(entry, field, value.strip())
    if changes.get("active") is not None:
        entry.active = changes["active"]
    _commit_catalog_change(db, "Approved deviation code already exists")
    db.refresh(entry)
    return entry


def _commit_catalog_change(db: Session, conflict_detail: str) -> None:
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise DeviationCatalogError(409, conflict_detail) from exc


def resolve_deviation(
        db: Session, deviation: Deviation, action: str, user: User,
        approved_deviation_id: int | None = None,
        rejection_reason: str | None = None) -> Deviation:
    """Resolve and audit one deviation in a single database transaction."""
    if deviation.status != "PENDING":
        raise DeviationCatalogError(409, "Deviation is no longer pending")
    measurement = db.get(Measurement, deviation.measurement_id)
    inspection = db.get(Inspection, measurement.inspection_id)
    if inspection.annulled_at is not None and deviation.origin == "AUTO":
        raise DeviationCatalogError(409, "Annulled inspection is immutable")

    approved = None
    reason = None
    if action == "accept":
        if rejection_reason is not None:
            raise DeviationCatalogError(422, "Acceptance does not accept free text")
        if approved_deviation_id is None:
            raise DeviationCatalogError(422, "Approved deviation selection is required")
        approved = db.get(ApprovedDeviation, approved_deviation_id)
        if approved is None:
            raise DeviationCatalogError(404, "Approved deviation not found")
        if not approved.active:
            raise DeviationCatalogError(422, "Approved deviation is inactive")
    elif action == "reject":
        if approved_deviation_id is not None:
            raise DeviationCatalogError(422, "Rejection does not accept a catalog selection")
        reason = (rejection_reason or "").strip()
        if not reason:
            raise DeviationCatalogError(422, "Rejection reason is required")
    else:
        raise DeviationCatalogError(422, "Invalid disposition action")

    resolved_at = utcnow()
    deviation.status = "ACCEPTED" if approved else "REJECTED"
    deviation.approved_deviation_id = approved.id if approved else None
    deviation.approved_deviation_code_snapshot = approved.code if approved else None
    deviation.approved_deviation_description_snapshot = (
        approved.description if approved else None
    )
    deviation.rejection_reason = reason
    deviation.resolved_by = user.id
    deviation.resolved_at = resolved_at
    db.add(DeviationAuditEvent(
        deviation_id=deviation.id,
        action=deviation.status,
        actor_id=user.id,
        approved_deviation_id=deviation.approved_deviation_id,
        approved_deviation_code_snapshot=deviation.approved_deviation_code_snapshot,
        approved_deviation_description_snapshot=(
            deviation.approved_deviation_description_snapshot
        ),
        rejection_reason=reason,
        created_at=resolved_at,
    ))

    if deviation.origin == "AUTO":
        measurement.status = (
            MeasurementStatus.DEVIATION_ACCEPTED if approved
            else MeasurementStatus.REJECTED
        )
        measurement.disposition_by = user.id
        measurement.disposition_at = resolved_at
        measurement.disposition_note = (
            f"{approved.code}: {approved.description}" if approved else reason
        )
        inspection.status = worst_of(db.scalars(select(Measurement.status).where(
            Measurement.inspection_id == inspection.id,
        )).all())

    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise DeviationCatalogError(409, "Deviation resolution conflict") from exc
    db.refresh(deviation)
    return deviation
