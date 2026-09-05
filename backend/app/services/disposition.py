"""Deviation disposition service: pending queue, accept/reject, audit (design ADR-5)."""
from sqlalchemy import or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models import Deviation, Inspection, Measurement, PartType, Piece, User, utcnow
from app.schemas import DeviationOut, MeasurementOut, QueueInspectionOut
from app.services.status import MeasurementStatus, worst_of


class DispositionError(Exception):
    """Business rule violation; maps to an HTTP status in the router."""

    def __init__(self, status_code: int, detail: str):
        self.status_code = status_code
        self.detail = detail
        super().__init__(detail)


def _recompute_status(db: Session, inspection: Inspection) -> None:
    inspection.status = worst_of(db.scalars(select(Measurement.status).where(
        Measurement.inspection_id == inspection.id)).all())


def create_manual_deviation(db: Session, inspection_id: int,
                            measurement_id: int, description: str,
                            user: User) -> Deviation:
    """Attach a pending MANUAL deviation without changing dimensional status."""
    description = description.strip()
    if not description:
        raise DispositionError(422, "Manual deviation description is required")
    measurement = db.get(Measurement, measurement_id)
    if measurement is None:
        raise DispositionError(404, "Measurement not found")
    if measurement.inspection_id != inspection_id:
        raise DispositionError(409, "Measurement does not belong to inspection")
    existing = db.scalar(select(Deviation).where(
        Deviation.measurement_id == measurement_id,
        Deviation.origin == "MANUAL",
        Deviation.status == "PENDING",
    ))
    if existing is not None:
        raise DispositionError(409, "Pending manual deviation already exists")

    deviation = Deviation(
        measurement_id=measurement_id,
        origin="MANUAL",
        status="PENDING",
        description=description,
        created_by=user.id,
    )
    db.add(deviation)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise DispositionError(
            409, "Pending manual deviation already exists",
        ) from exc
    db.refresh(deviation)
    return deviation


def pending_queue(db: Session, include_resolved: bool = False) -> list[dict]:
    """Group deviations, optionally including persisted resolution history."""
    status_filters = [] if include_resolved else [Deviation.status == "PENDING"]
    inspections = db.scalars(select(Inspection).join(
        Measurement, Measurement.inspection_id == Inspection.id,
    ).join(
        Deviation, Deviation.measurement_id == Measurement.id,
    ).where(
        *status_filters,
        or_(
            Inspection.annulled_at.is_(None),
            Deviation.origin == "MANUAL",
        ),
    ).distinct().order_by(
        Inspection.completed_at.desc(), Inspection.started_at.desc(),
        Inspection.id.desc(),
    )).all()
    groups = []
    for inspection in inspections:
        piece = db.get(Piece, inspection.piece_id)
        part_type = db.get(PartType, piece.part_type_id)
        deviation_filters = [
            Measurement.inspection_id == inspection.id,
            *status_filters,
        ]
        if inspection.annulled_at is not None:
            deviation_filters.append(Deviation.origin == "MANUAL")
        deviations = db.scalars(select(Deviation).join(
            Measurement, Measurement.id == Deviation.measurement_id,
        ).where(*deviation_filters).order_by(Deviation.id)).all()
        measurement_ids = list(dict.fromkeys(
            deviation.measurement_id for deviation in deviations
        ))
        measurements = [db.get(Measurement, item) for item in measurement_ids]
        groups.append({
            "inspection": QueueInspectionOut(
                id=inspection.id, part_number=part_type.part_number,
                inspector=db.get(User, inspection.inspector_id).username,
                completed_at=inspection.completed_at,
                annulled_at=inspection.annulled_at,
                status=inspection.status),
            "deviations": [DeviationOut.model_validate(d) for d in deviations],
            "measurements": [MeasurementOut.model_validate(m) for m in measurements],
        })
    return groups


def resolve_deviation(
        db: Session, deviation: Deviation, action: str, user: User,
        approved_deviation_id: int | None = None,
        rejection_reason: str | None = None) -> Deviation:
    """Delegate every resolution path to the catalog-aware transaction service."""
    from app.services import deviation_catalog

    try:
        return deviation_catalog.resolve_deviation(
            db, deviation, action, user,
            approved_deviation_id=approved_deviation_id,
            rejection_reason=rejection_reason,
        )
    except deviation_catalog.DeviationCatalogError as exc:
        raise DispositionError(exc.status_code, exc.detail) from exc


def annul_inspection(db: Session, inspection: Inspection, reason: str,
                     user: User) -> Inspection:
    """Annul a completed inspection while retaining its immutable record and audit."""
    if not reason.strip():
        raise DispositionError(422, "Annulment reason is required")
    if inspection.completed_at is None:
        raise DispositionError(409, "Only completed inspections can be annulled")
    if inspection.annulled_at is not None:
        raise DispositionError(409, "Inspection is already annulled")
    _recompute_status(db, inspection)
    inspection.annulled_at = utcnow()
    inspection.annulled_by = user.id
    inspection.annulment_reason = reason.strip()
    db.commit()
    db.refresh(inspection)
    return inspection
