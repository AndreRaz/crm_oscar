"""Inspection report tests (spec: inspection-report)."""
import pytest

from app.models import Inspection, PartType
from tests.conftest import login, make_user
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


def test_report_download_allows_admin_and_owner_but_denies_other_inspector(db, client):
    seed_pending_deviation(client, db)

    assert client.get("/api/inspections/1/report.pdf").status_code == 200
    client.post("/api/auth/logout")
    login(client, "raul")
    assert client.get("/api/inspections/1/report.pdf").status_code == 200

    client.post("/api/auth/logout")
    make_user(db, "other")
    login(client, "other")
    assert client.get("/api/inspections/1/report.pdf").status_code == 403


def test_repeated_render_reads_latest_disposition_without_storing_pdf(db, client, tmp_path):
    seed_pending_deviation(client, db)
    from app.services.report import render_report_html

    before = render_report_html(db, db.get(Inspection, 1))
    dispose(client, action="reject", text="Scrap after review")
    after = render_report_html(db, db.get(Inspection, 1))

    assert "PENDING" in before
    assert "Scrap after review" not in before
    assert "REJECTED" in after
    assert "Scrap after review" in after
    assert list(tmp_path.glob("*.pdf")) == []


def test_report_download_returns_pdf_bytes_when_weasyprint_is_available(db, client):
    pytest.importorskip("weasyprint")
    seed_pending_deviation(client, db)

    response = client.get("/api/inspections/1/report.pdf")

    assert response.status_code == 200
    assert response.headers["content-type"] == "application/pdf"
    assert response.content.startswith(b"%PDF")
