"""Inspection execution service: start, record, complete (design ADR-4/5/8)."""
from math import isfinite
from sqlite3 import SQLITE_BUSY, SQLITE_LOCKED

from sqlalchemy import select, update
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session

from app.models import (
    Characteristic, Deviation, Inspection, Measurement, PartRevision,
    PartType, Piece, User, utcnow,
)
from app.services.status import InspectionStatus, MeasurementStatus, worst_of
from app.services.tolerance import evaluate


class InspectionError(Exception):
    """Business rule violation; maps to an HTTP status in the router."""

    def __init__(self, status_code: int, detail: str):
        self.status_code = status_code
        self.detail = detail
        super().__init__(detail)


def resolve_limits(c: Characteristic) -> tuple[float, float, float]:
    """Return the characteristic's canonical persisted evaluation basis."""
    return c.nominal, c.min_limit, c.max_limit


def current_part_revision(db: Session, part_type: PartType) -> PartRevision:
    """Return the immutable revision matching the part's current revision_no."""
    revision = db.scalar(select(PartRevision).where(
        PartRevision.part_type_id == part_type.id,
        PartRevision.revision_no == part_type.revision_no))
    if revision is None:
        raise InspectionError(409, "Part type has no current revision")
    return revision


def start_inspection(db: Session, part_type_id: int,
                     characteristic_ids: list[int], user: User) -> Inspection:
    part_type = db.get(PartType, part_type_id)
    if part_type is None:
        raise InspectionError(404, "Part type not found")
    if not part_type.active:
        raise InspectionError(409, "Part type is inactive")
    if len(set(characteristic_ids)) != len(characteristic_ids):
        raise InspectionError(422, "Duplicate characteristic in selection")
    selected = {c.id: c for c in db.scalars(
        select(Characteristic).where(Characteristic.id.in_(characteristic_ids), Characteristic.active.is_(True)))}
    for cid in characteristic_ids:
        c = selected.get(cid)
        if c is None or c.part_type_id != part_type_id:
            raise InspectionError(422, "Characteristic does not belong to the selected part type")
    revision = current_part_revision(db, part_type)
    piece = Piece(part_type_id=part_type_id)
    db.add(piece)
    db.flush()
    inspection = Inspection(piece_id=piece.id,
                             part_revision_id=revision.id,
                             inspector_id=user.id,
                             selected_characteristic_ids=",".join(map(str, characteristic_ids)),
                             status=InspectionStatus.PENDING)
    db.add(inspection)
    db.commit()
    db.refresh(inspection)
    return inspection


def _reserve_recording_write(db: Session, inspection: Inspection) -> None:
    """Reserve SQLite's writer before reading the evaluation basis.

    Legacy sqlite3 SELECTs do not begin a database transaction. This
    value-preserving DML starts one and excludes other writers until the
    measurement/deviation commit (or request rollback), without changing
    inspection evidence. Refresh afterward to discard pre-lock ORM state.
    """
    try:
        db.execute(update(Inspection.__table__).where(
            Inspection.id == inspection.id).values(id=Inspection.id))
    except OperationalError as exc:
        code = getattr(exc.orig, "sqlite_errorcode", 0)
        if code & 0xFF not in (SQLITE_BUSY, SQLITE_LOCKED):
            raise
        db.rollback()
        raise InspectionError(
            409, "Another database write is in progress. Retry the measurement.",
        ) from exc
    db.refresh(inspection)


def record_measurement(db: Session, inspection: Inspection,
                       characteristic_id: int, actual: float) -> Measurement:
    if not isfinite(actual):
        raise InspectionError(422, "Measurement must be finite")
    _reserve_recording_write(db, inspection)
    if inspection.completed_at is not None or inspection.annulled_at is not None:
        raise InspectionError(409, "Inspection is locked")
    if characteristic_id not in map(int, inspection.selected_characteristic_ids.split(",")):
        raise InspectionError(422, "Characteristic was not selected for this inspection")
    piece = db.get(Piece, inspection.piece_id)
    part_type = db.get(PartType, piece.part_type_id, populate_existing=True)
    if part_type is None:
        raise InspectionError(409, "Inspected part type is unavailable")
    if current_part_revision(db, part_type).id != inspection.part_revision_id:
        raise InspectionError(
            409, "Part revision changed since inspection start. "
            "Start a new inspection; saved measurements are preserved.",
        )
    c = db.get(Characteristic, characteristic_id, populate_existing=True)
    if c is None or not c.active or c.part_type_id != piece.part_type_id:
        raise InspectionError(422, "Characteristic does not belong to the inspected part type")
    if db.scalar(select(Measurement).where(
            Measurement.inspection_id == inspection.id,
            Measurement.characteristic_id == characteristic_id)) is not None:
        raise InspectionError(409, "Characteristic already measured for this inspection")
    nominal, lower, upper = resolve_limits(c)
    status = evaluate(actual, nominal, lower, upper)
    measurement = Measurement(
        inspection_id=inspection.id, characteristic_id=characteristic_id,
        actual_value=actual, nominal_snapshot=nominal,
        min_limit_snapshot=lower, max_limit_snapshot=upper,
        measurement_method_snapshot=c.measurement_method,
        deviation=actual - nominal, status=status)
    db.add(measurement)
    db.flush()
    if status is MeasurementStatus.PENDING:
        db.add(Deviation(
            measurement_id=measurement.id,
            origin="AUTO",
            status="PENDING",
        ))
    db.commit()
    db.refresh(measurement)
    return measurement


def complete_inspection(db: Session, inspection: Inspection) -> Inspection:
    if inspection.completed_at is not None:
        raise InspectionError(409, "Inspection already completed")
    statuses = db.scalars(select(Measurement.status).where(
        Measurement.inspection_id == inspection.id)).all()
    inspection.status = worst_of(statuses)
    inspection.completed_at = utcnow()
    db.commit()
    db.refresh(inspection)
    return inspection
