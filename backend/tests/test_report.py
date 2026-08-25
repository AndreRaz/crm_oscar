"""Canonical inspection report evidence tests."""
from sqlalchemy import select

from app.models import Characteristic, Deviation, Inspection, PartType
from tests.conftest import login
from tests.test_disposition import (
    create_manual, resolve_deviation, seed_pending_deviation,
)
from tests.test_inspection import (
    admin_client, inspector_client, record, setup_catalog, start,
)


def test_report_contains_canonical_part_measurement_and_accepted_disposition(
        db, client):
    seed_pending_deviation(client, db)
    part_type = db.get(PartType, 1)
    part_type.legacy_code = "SECRET-LEGACY"
    part_type.part_number = "LIVE-EDIT"
    part_type.part_description = "Live description must not replace revision evidence"
    characteristic = db.get(Characteristic, 2)
    characteristic.control_plan = "LIVE-CP"
    characteristic.measurement_method = "Edited method must not replace snapshot"
    db.commit()
    deviation = db.scalar(select(Deviation).where(Deviation.origin == "AUTO"))
    assert resolve_deviation(client, deviation.id).status_code == 200

    from app.services.report import render_report_html

    html = render_report_html(db, db.get(Inspection, 1))

    assert "BRK-001" in html
    assert "Bracket" in html
    assert "LIVE-EDIT" not in html and "Live description" not in html
    assert "raul" in html
    assert db.get(Inspection, 1).completed_at.isoformat() in html
    assert "CP-01" in html and "CP-02" in html
    assert "LIVE-CP" not in html
    assert "Caliper method CP-02" in html
    assert "Edited method must not replace snapshot" not in html
    assert "9.9" in html and "10.1" in html and "10.5" in html
    assert "AD-001" in html and "Use as-is" in html
    assert "ACCEPTED_WITH_DEVIATIONS" in html
    assert "SECRET-LEGACY" not in html
    assert "Serie" not in html and "serial" not in html.lower()


def test_report_includes_manual_rejection_reason_without_changing_conforming_status(
        db, client):
    admin_client(client, db)
    setup_catalog(client, chars=("CP-01",))
    client.post("/api/auth/logout")
    inspector_client(client, db)
    start(client, characteristic_ids=(1,))
    record(client, actual=10.0)
    assert create_manual(client, description="Visual surface defect").status_code == 201
    assert client.post("/api/inspections/1/complete").status_code == 200
    client.post("/api/auth/logout")
    login(client, "admin")
    deviation = db.scalar(select(Deviation).where(Deviation.origin == "MANUAL"))
    assert resolve_deviation(
        client, deviation.id, action="reject", rejection_reason="Reject surface defect",
    ).status_code == 200

    from app.services.report import render_report_html

    html = render_report_html(db, db.get(Inspection, 1))

    assert "CONFORMING" in html
    assert "Visual surface defect" in html
    assert "Reject surface defect" in html
    assert "MANUAL" in html and "REJECTED" in html


def test_conforming_report_has_measurements_without_disposition_section(db, client):
    admin_client(client, db)
    setup_catalog(client)
    client.post("/api/auth/logout")
    inspector_client(client, db)
    start(client)
    record(client, characteristic_id=1, actual=10.0)
    record(client, characteristic_id=2, actual=9.95)
    client.post("/api/inspections/1/complete")

    from app.services.report import render_report_html

    html = render_report_html(db, db.get(Inspection, 1))

    assert "CONFORMING" in html
    assert "CP-01" in html and "CP-02" in html
    assert "Caliper method CP-01" in html and "Caliper method CP-02" in html
    assert 'id="dispositions"' not in html
    assert "Evidencia de disposición" not in html
