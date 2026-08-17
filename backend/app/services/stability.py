"""Scoped stability trend data for one part type and characteristic."""
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Characteristic, Inspection, Measurement, Piece
from app.services.inspection import resolve_limits


def analysis(db: Session, part_type_id: int, characteristic_id: int) -> dict:
    characteristic = db.get(Characteristic, characteristic_id)
    nominal, lower, upper = resolve_limits(characteristic)
    rows = db.execute(
        select(Measurement, Inspection, Piece)
        .join(Inspection, Measurement.inspection_id == Inspection.id)
        .join(Piece, Inspection.piece_id == Piece.id)
        .where(
            Piece.part_type_id == part_type_id,
            Measurement.characteristic_id == characteristic_id,
            Inspection.completed_at.is_not(None),
        )
        .order_by(Inspection.completed_at, Inspection.id)
    ).all()
    return {
        "characteristic": {
            "code": characteristic.code,
            "name": characteristic.name,
            "unit": characteristic.unit,
            "nominal": nominal,
            "lower_limit": lower,
            "upper_limit": upper,
        },
        "points": [{
            "inspection_id": inspection.id,
            "serial": piece.serial,
            "completed_at": inspection.completed_at,
            "actual": measurement.actual_value,
            "deviation": measurement.deviation,
            "status": measurement.status,
        } for measurement, inspection, piece in rows],
    }
