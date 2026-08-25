"""Canonical catalog-to-persisted-report backend workflow."""
import hashlib
import json
import os

os.environ["DATABASE_URL"] = "sqlite://"

from sqlalchemy import select

from app.models import (
    Deviation, DeviationAuditEvent, GeneratedReport, Measurement, Piece,
)
from tests.conftest import login, make_user


def test_canonical_inspection_deviation_and_persisted_report_flow(
        db, client, tmp_path):
    admin = make_user(db, "admin", role="admin")
    inspector = make_user(db, "inspector", role="inspector")
    assert login(client, admin.username).status_code == 200

    part_response = client.post("/api/part-types", json={
        "part_number": "BRK-E2E-001",
        "part_description": "Integration bracket",
    })
    assert part_response.status_code == 201
    part = part_response.json()
    assert part["revision_no"] == 1
    assert "legacy_code" not in part

    characteristic_response = client.post(
        f"/api/part-types/{part['id']}/characteristics",
        json={
            "control_plan": "CP-E2E-01",
            "name": "Outside diameter",
            "unit": "mm",
            "measurement_method": "Digital micrometer",
            "tol_type": "SYMMETRIC",
            "nominal": 10.0,
            "tol_plus": 0.1,
            "tol_minus": 0.2,
        },
    )
    assert characteristic_response.status_code == 201
    characteristic = characteristic_response.json()
    assert characteristic["control_plan"] == "CP-E2E-01"
    assert (characteristic["min_limit"], characteristic["max_limit"]) == (9.8, 10.1)

    approved_response = client.post("/api/approved-deviations", json={
        "code": "AD-E2E-01",
        "description": "Approved for integration evidence",
    })
    assert approved_response.status_code == 201
    approved = approved_response.json()

    assert client.post("/api/auth/logout").status_code == 200
    assert login(client, inspector.username).status_code == 200
    inspection_response = client.post("/api/inspections", json={
        "part_type_id": part["id"],
        "characteristic_ids": [characteristic["id"]],
    })
    assert inspection_response.status_code == 201
    inspection = inspection_response.json()
    assert "serial" not in inspection
    assert inspection["part_revision_id"] > 0
    assert db.scalar(select(Piece)).part_type_id == part["id"]

    measurement_response = client.post(
        f"/api/inspections/{inspection['id']}/measurements",
        json={"characteristic_id": characteristic["id"], "actual_value": 10.5},
    )
    assert measurement_response.status_code == 201
    measurement = measurement_response.json()
    assert measurement["status"] == "PENDING"
    assert measurement["measurement_method_snapshot"] == "Digital micrometer"
    deviation = db.scalar(select(Deviation).where(
        Deviation.measurement_id == measurement["id"],
        Deviation.origin == "AUTO",
    ))
    assert deviation is not None

    queue_response = client.get("/api/deviations")
    assert queue_response.status_code == 200
    assert "serial" not in json.dumps(queue_response.json()).lower()
    assert queue_response.json()["groups"][0]["inspection"]["part_number"] == "BRK-E2E-001"

    assert client.post("/api/auth/logout").status_code == 200
    assert login(client, admin.username).status_code == 200
    resolution_response = client.post(
        f"/api/deviations/{deviation.id}/resolution",
        json={"action": "accept", "approved_deviation_id": approved["id"]},
    )
    assert resolution_response.status_code == 200
    assert resolution_response.json()["status"] == "ACCEPTED"

    audit = db.scalar(select(DeviationAuditEvent).where(
        DeviationAuditEvent.deviation_id == deviation.id,
    ))
    assert audit is not None
    assert audit.actor_id == admin.id
    assert audit.approved_deviation_id == approved["id"]
    assert audit.approved_deviation_code_snapshot == "AD-E2E-01"
    assert audit.action == "ACCEPTED"
    assert db.get(Measurement, measurement["id"]).status.value == "DEVIATION_ACCEPTED"

    assert client.post("/api/auth/logout").status_code == 200
    assert login(client, inspector.username).status_code == 200
    completion_response = client.post(f"/api/inspections/{inspection['id']}/complete")
    assert completion_response.status_code == 200
    assert completion_response.json()["status"] == "ACCEPTED_WITH_DEVIATIONS"

    report_response = client.post(f"/api/inspections/{inspection['id']}/reports")
    assert report_response.status_code == 201
    report_body = report_response.json()
    report = db.get(GeneratedReport, report_body["id"])
    assert report is not None
    report_path = tmp_path / report.file_path
    assert report_path.is_file()
    persisted_pdf = report_path.read_bytes()
    assert persisted_pdf.startswith(b"%PDF")
    assert report.content_hash == hashlib.sha256(persisted_pdf).hexdigest()
    assert report.part_revision_id == inspection["part_revision_id"]

    listing_response = client.get("/api/reports")
    assert listing_response.status_code == 200
    assert [item["id"] for item in listing_response.json()] == [report.id]
    download_response = client.get(f"/api/reports/{report.id}/download")
    assert download_response.status_code == 200
    assert download_response.headers["content-type"] == "application/pdf"
    assert download_response.content == persisted_pdf
