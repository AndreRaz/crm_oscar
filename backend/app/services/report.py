"""Build inspection report HTML from immutable inspection evidence."""
import json

from jinja2 import Environment, PackageLoader, select_autoescape
from sqlalchemy import select
from sqlalchemy.orm import Session
from weasyprint import HTML

from app.models import Characteristic, Deviation, Inspection, Measurement, PartRevision, User
from app.services.catalog import images_dir

_templates = Environment(
    loader=PackageLoader("app", "templates"),
    autoescape=select_autoescape(default=True),
)


def _value(value: float | None) -> str:
    return "—" if value is None else str(round(value, 6))


def render_report_html(db: Session, inspection: Inspection) -> str:
    """Render an inspection using snapshots and its latest disposition state."""
    revision = db.get(PartRevision, inspection.part_revision_id)
    part = json.loads(revision.definition_json)
    revision_characteristics = {
        row["id"]: row for row in part.get("characteristics", [])
    }
    inspector = db.get(User, inspection.inspector_id)
    result = db.execute(
        select(Measurement, Characteristic)
        .join(Characteristic, Characteristic.id == Measurement.characteristic_id)
        .where(Measurement.inspection_id == inspection.id)
        .order_by(Characteristic.sort_order, Characteristic.id)
    ).all()
    measurement_ids = [measurement.id for measurement, _ in result]
    deviations = db.scalars(select(Deviation).where(
        Deviation.measurement_id.in_(measurement_ids)
    ).order_by(Deviation.id)).all() if measurement_ids else []
    deviations_by_measurement: dict[int, list[Deviation]] = {}
    for deviation in deviations:
        deviations_by_measurement.setdefault(deviation.measurement_id, []).append(deviation)
    measurements = [{
        "control_plan": revision_characteristics.get(
            characteristic.id, {}
        ).get("control_plan", characteristic.control_plan),
        "name": revision_characteristics.get(
            characteristic.id, {}
        ).get("name", characteristic.name),
        "unit": revision_characteristics.get(
            characteristic.id, {}
        ).get("unit", characteristic.unit),
        "method": measurement.measurement_method_snapshot or "—",
        "nominal": _value(measurement.nominal_snapshot),
        "min_limit": _value(measurement.min_limit_snapshot),
        "max_limit": _value(measurement.max_limit_snapshot),
        "actual": _value(measurement.actual_value),
        "deviation": _value(measurement.deviation),
        "status": measurement.status.value,
        "deviations": deviations_by_measurement.get(measurement.id, []),
    } for measurement, characteristic in result]
    image_uri = None
    if part.get("image_path"):
        image_uri = (images_dir() / part["image_path"]).resolve().as_uri()
    return _templates.get_template("report.html.j2").render(
        inspection=inspection,
        part=part,
        inspector=inspector,
        report_at=inspection.completed_at or inspection.started_at,
        image_uri=image_uri,
        measurements=measurements,
        disposition_notes=[
            {"control_plan": row["control_plan"], "deviation": deviation}
            for row in measurements for deviation in row["deviations"]
            if (
                deviation.description
                or deviation.approved_deviation_code_snapshot
                or deviation.rejection_reason
            )
        ],
    )


def render_report_pdf(db: Session, inspection: Inspection) -> bytes:
    """Generate PDF bytes in memory; no report artifact is persisted."""
    html = render_report_html(db, inspection)
    return HTML(string=html, base_url=str(images_dir())).write_pdf()


def may_access_report(user: User, inspection: Inspection) -> bool:
    return user.role == "admin" or inspection.inspector_id == user.id
