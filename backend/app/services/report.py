"""Build inspection report HTML from the current database state."""
from jinja2 import Environment, PackageLoader, select_autoescape
from sqlalchemy import select
from sqlalchemy.orm import Session
from weasyprint import HTML

from app.models import Characteristic, Inspection, Measurement, PartType, Piece, User
from app.services.catalog import images_dir

_templates = Environment(
    loader=PackageLoader("app", "templates"),
    autoescape=select_autoescape(default=True),
)


def _value(value: float | None) -> str:
    return "—" if value is None else str(round(value, 6))


def _tolerance(lower: float | None, upper: float | None) -> str:
    if lower is None:
        return f"≤ {_value(upper)}"
    if upper is None:
        return f"≥ {_value(lower)}"
    return f"{_value(lower)} – {_value(upper)}"


def render_report_html(db: Session, inspection: Inspection) -> str:
    """Render an inspection using snapshots and its latest disposition state."""
    piece = db.get(Piece, inspection.piece_id)
    part_type = db.get(PartType, piece.part_type_id)
    inspector = db.get(User, inspection.inspector_id)
    result = db.execute(
        select(Measurement, Characteristic)
        .join(Characteristic, Characteristic.id == Measurement.characteristic_id)
        .where(Measurement.inspection_id == inspection.id)
        .order_by(Characteristic.sort_order, Characteristic.id)
    ).all()
    measurements = [{
        "code": characteristic.code,
        "name": characteristic.name,
        "unit": characteristic.unit,
        "nominal": _value(measurement.nominal_snapshot),
        "tolerance": _tolerance(measurement.lower_limit_snapshot,
                                measurement.upper_limit_snapshot),
        "actual": _value(measurement.actual_value),
        "deviation": _value(measurement.deviation),
        "status": measurement.status.value,
        "note": measurement.disposition_note,
    } for measurement, characteristic in result]
    image_uri = None
    if part_type.image_path:
        image_uri = (images_dir() / part_type.image_path).resolve().as_uri()
    return _templates.get_template("report.html.j2").render(
        inspection=inspection,
        part_type=part_type,
        piece=piece,
        inspector=inspector,
        report_at=inspection.completed_at or inspection.started_at,
        image_uri=image_uri,
        measurements=measurements,
        disposition_notes=[row for row in measurements if row["note"]],
    )


def render_report_pdf(db: Session, inspection: Inspection) -> bytes:
    """Generate PDF bytes in memory; no report artifact is persisted."""
    html = render_report_html(db, inspection)
    return HTML(string=html, base_url=str(images_dir())).write_pdf()


def may_download_report(user: User, inspection: Inspection) -> bool:
    return user.role == "admin" or inspection.inspector_id == user.id
