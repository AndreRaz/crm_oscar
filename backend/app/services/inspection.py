"""Inspection execution service: start, record, complete (design ADR-4/5/8)."""
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import (
    Characteristic, Inspection, Measurement, PartType, Piece, User,
)
from app.services.status import InspectionStatus
from app.services.tolerance import evaluate


class InspectionError(Exception):
    """Business rule violation; maps to an HTTP status in the router."""

    def __init__(self, status_code: int, detail: str):
        self.status_code = status_code
        self.detail = detail
        super().__init__(detail)


def resolve_limits(c: Characteristic) -> tuple[float | None, float | None, float | None]:
    """Resolved tolerance basis (ADR-4): nominal plus lower/upper limit copies."""
    if c.tol_type == "SYMMETRIC":
        return c.nominal, c.nominal - c.tol_plus, c.nominal + c.tol_plus
    return c.nominal, c.min_limit, c.max_limit


def start_inspection(db: Session, part_type_id: int, serial: str,
                     characteristic_ids: list[int], user: User) -> Inspection:
    part_type = db.get(PartType, part_type_id)
    if part_type is None:
        raise InspectionError(404, "Part type not found")
    if not part_type.active:
        raise InspectionError(409, "Part type is inactive")
    if len(set(characteristic_ids)) != len(characteristic_ids):
        raise InspectionError(422, "Duplicate characteristic in selection")
    selected = {c.id: c for c in db.scalars(
        select(Characteristic).where(Characteristic.id.in_(characteristic_ids)))}
    for cid in characteristic_ids:
        c = selected.get(cid)
        if c is None or c.part_type_id != part_type_id:
            raise InspectionError(422, "Characteristic does not belong to the selected part type")
    piece = db.scalar(select(Piece).where(
        Piece.part_type_id == part_type_id, Piece.serial == serial))
    if piece is not None:
        raise InspectionError(409, "Serial already used for this part type")
    piece = Piece(part_type_id=part_type_id, serial=serial)
    db.add(piece)
    db.flush()
    inspection = Inspection(piece_id=piece.id, inspector_id=user.id,
                             status=InspectionStatus.PENDING)
    db.add(inspection)
    db.commit()
    db.refresh(inspection)
    return inspection


def record_measurement(db: Session, inspection: Inspection,
                       characteristic_id: int, actual: float) -> Measurement:
    if inspection.completed_at is not None:
        raise InspectionError(409, "Inspection is locked")
    piece = db.get(Piece, inspection.piece_id)
    c = db.get(Characteristic, characteristic_id)
    if c is None or c.part_type_id != piece.part_type_id:
        raise InspectionError(422, "Characteristic does not belong to the inspected part type")
    if db.scalar(select(Measurement).where(
            Measurement.inspection_id == inspection.id,
            Measurement.characteristic_id == characteristic_id)) is not None:
        raise InspectionError(409, "Characteristic already measured for this inspection")
    nominal, lower, upper = resolve_limits(c)
    measurement = Measurement(
        inspection_id=inspection.id, characteristic_id=characteristic_id,
        actual_value=actual, nominal_snapshot=nominal,
        lower_limit_snapshot=lower, upper_limit_snapshot=upper,
        deviation=actual - nominal if nominal is not None else None,
        status=evaluate(actual, nominal, lower, upper))
    db.add(measurement)
    db.commit()
    db.refresh(measurement)
    return measurement
