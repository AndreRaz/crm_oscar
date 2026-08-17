"""Inspection report tests (spec: inspection-report)."""
from app.models import Inspection, PartType
from tests.test_disposition import dispose, seed_pending_deviation
from tests.test_inspection import (
    admin_client, inspector_client, record, setup_catalog, start,
)


def test_report_html_contains_identity_measurements_image_and_disposition(
        db, client, tmp_path, monkeypatch):
    monkeypatch.setenv("IMAGES_DIR", str(tmp_path))
    seed_pending_deviation(client, db)
    (tmp_path / "1.png").write_bytes(b"part-image")
    part_type = db.get(PartType, 1)
    part_type.image_path = "1.png"
    db.commit()
    dispose(client, action="accept", text="Concession approved")

    from app.services.report import render_report_html

    html = render_report_html(db, db.get(Inspection, 1))

    assert "BRK-001" in html
    assert "S-001" in html
    assert "raul" in html
    assert db.get(Inspection, 1).completed_at.isoformat() in html
    assert (tmp_path / "1.png").as_uri() in html
    assert "A1" in html and "A2" in html
    assert "10.0" in html
    assert "9.9 – 10.1" in html
    assert "10.5" in html
    assert "0.5" in html
    assert "DEVIATION_ACCEPTED" in html
    assert "Concession approved" in html
    assert "ACCEPTED_WITH_DEVIATIONS" in html


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
    assert "A1" in html and "A2" in html
    assert 'id="dispositions"' not in html
    assert "Notas de disposición" not in html
