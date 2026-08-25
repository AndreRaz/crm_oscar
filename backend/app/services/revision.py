"""Immutable part-revision lifecycle: snapshots and restore-as-new."""
import json

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Balloon, Characteristic, Measurement, PartRevision, PartType

_CHARACTERISTIC_FIELDS = (
    "name", "unit", "measurement_method", "tol_type", "nominal", "tol_plus",
    "tol_minus", "min_limit", "max_limit", "sort_order", "active",
)


class RevisionNotFoundError(LookupError):
    """The requested part type or revision does not exist."""


def build_definition(db: Session, part_type: PartType) -> dict:
    """Capture the complete live part definition as a JSON-safe dict."""
    balloons = {balloon.characteristic_id: balloon for balloon in db.scalars(
        select(Balloon).where(Balloon.part_type_id == part_type.id))}
    characteristics = []
    for characteristic in db.scalars(
            select(Characteristic).where(Characteristic.part_type_id == part_type.id)
            .order_by(Characteristic.sort_order, Characteristic.id)):
        balloon = balloons.get(characteristic.id)
        characteristics.append({
            "id": characteristic.id,
            "control_plan": characteristic.control_plan,
            **{field: getattr(characteristic, field)
               for field in _CHARACTERISTIC_FIELDS},
            "balloon": None if balloon is None else {"x": balloon.x, "y": balloon.y},
        })
    return {
        "part_number": part_type.part_number,
        "part_description": part_type.part_description,
        "legacy_code": part_type.legacy_code,
        "image_path": part_type.image_path,
        "active": part_type.active,
        "characteristics": characteristics,
    }


def serialize_definition(definition: dict) -> str:
    return json.dumps(definition, sort_keys=True, separators=(",", ":"))


def create_revision(db: Session, part_type: PartType, user_id: int | None,
                    *, increment: bool = True) -> PartRevision:
    """Snapshot the definition and bump revision_no in the caller's transaction."""
    if increment:
        part_type.revision_no += 1
    revision = PartRevision(
        part_type_id=part_type.id,
        revision_no=part_type.revision_no,
        definition_json=serialize_definition(build_definition(db, part_type)),
        created_by=user_id,
    )
    db.add(revision)
    db.flush()
    return revision


def restore_revision(db: Session, part_type_id: int, revision_no: int,
                     user_id: int) -> PartRevision:
    """Copy a prior revision's definition into the live tables as a NEW revision.

    Prior revisions and completed-inspection evidence are never rewritten; the
    whole copy plus the new revision commits atomically with the caller.
    """
    part_type = db.get(PartType, part_type_id)
    if part_type is None:
        raise RevisionNotFoundError("Part type not found")
    target = db.scalar(select(PartRevision).where(
        PartRevision.part_type_id == part_type_id,
        PartRevision.revision_no == revision_no))
    if target is None:
        raise RevisionNotFoundError("Revision not found")
    _apply_definition(db, part_type, json.loads(target.definition_json))
    return create_revision(db, part_type, user_id)


def _apply_definition(db: Session, part_type: PartType, definition: dict) -> None:
    part_type.part_number = definition["part_number"]
    part_type.part_description = definition["part_description"]
    part_type.image_path = definition["image_path"]
    part_type.active = definition["active"]
    for balloon in db.scalars(select(Balloon).where(
            Balloon.part_type_id == part_type.id)):
        db.delete(balloon)
    entries = {entry["control_plan"]: entry
               for entry in definition.get("characteristics", [])}
    by_control_plan = {
        characteristic.control_plan: characteristic for characteristic in
        db.scalars(select(Characteristic).where(
            Characteristic.part_type_id == part_type.id))
    }
    for control_plan, characteristic in by_control_plan.items():
        entry = entries.get(control_plan)
        if entry is None:
            _remove_characteristic(db, characteristic)
            continue
        for field in _CHARACTERISTIC_FIELDS:
            setattr(characteristic, field, entry.get(field))
    for control_plan, entry in entries.items():
        if control_plan in by_control_plan:
            continue
        characteristic = Characteristic(
            part_type_id=part_type.id, control_plan=control_plan,
            **{field: entry.get(field) for field in _CHARACTERISTIC_FIELDS})
        db.add(characteristic)
        by_control_plan[control_plan] = characteristic
    db.flush()
    for entry in definition.get("characteristics", []):
        balloon = entry.get("balloon")
        if balloon is None:
            continue
        db.add(Balloon(
            part_type_id=part_type.id,
            characteristic_id=by_control_plan[entry["control_plan"]].id,
            x=balloon["x"], y=balloon["y"]))
    db.flush()


def _remove_characteristic(db: Session, characteristic: Characteristic) -> None:
    """Retain measured characteristics as inactive; delete unmeasured ones."""
    if db.scalar(select(Measurement.id).where(
            Measurement.characteristic_id == characteristic.id)):
        characteristic.active = False
    else:
        db.delete(characteristic)
