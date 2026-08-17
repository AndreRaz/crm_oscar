"""Stability analysis tests (spec: stability-analysis)."""
from datetime import datetime, timezone

import pytest

from app.models import Inspection
from tests.conftest import login
from tests.test_inspection import (
    admin_client, inspector_client, record, start,
)


def setup_catalog(client):
    client.post("/api/part-types", json={"code": "BRK-001"})
    client.post("/api/part-types/1/characteristics", json={
        "code": "A1", "name": "Diameter", "unit": "mm",
        "tol_type": "SYMMETRIC", "nominal": 10.0, "tol_plus": 0.1,
    })
    client.post("/api/part-types/1/characteristics", json={
        "code": "L1", "name": "Width", "unit": "mm",
        "tol_type": "LIMITS", "min_limit": 9.5, "max_limit": 10.8,
    })


def complete_measurement(client, serial, characteristic_id, actual):
    inspection_id = int(serial.removeprefix("S-"))
    start(client, serial=serial, characteristic_ids=(characteristic_id,))
    record(client, inspection_id=inspection_id,
           characteristic_id=characteristic_id, actual=actual)
    client.post(f"/api/inspections/{inspection_id}/complete")
    return inspection_id


def get_stability(client, part_type_id=1, characteristic_id=1):
    return client.get("/api/stability", params={
        "part_type_id": part_type_id,
        "characteristic_id": characteristic_id,
    })


class TestStabilityContract:
    def test_returns_reference_lines_and_chronological_measurement_points(
            self, db, client):
        admin_client(client, db)
        setup_catalog(client)
        client.post("/api/auth/logout")
        inspector_client(client, db)
        complete_measurement(client, "S-001", 1, 10.05)
        complete_measurement(client, "S-002", 1, 9.95)
        db.get(Inspection, 1).completed_at = datetime(2026, 1, 2, tzinfo=timezone.utc)
        db.get(Inspection, 2).completed_at = datetime(2026, 1, 1, tzinfo=timezone.utc)
        db.commit()
        client.post("/api/auth/logout")
        login(client, "admin")

        response = get_stability(client)

        assert response.status_code == 200
        body = response.json()
        assert body["characteristic"] == {
            "code": "A1", "name": "Diameter", "unit": "mm",
            "nominal": 10.0, "lower_limit": pytest.approx(9.9),
            "upper_limit": pytest.approx(10.1),
        }
        assert [point["serial"] for point in body["points"]] == ["S-002", "S-001"]
        assert body["points"][0] == {
            "inspection_id": 2, "serial": "S-002",
            "completed_at": "2026-01-01T00:00:00", "actual": 9.95,
            "deviation": pytest.approx(-0.05), "status": "IN_TOLERANCE",
        }

    def test_pure_limits_measurement_has_nullable_deviation(self, db, client):
        admin_client(client, db)
        setup_catalog(client)
        client.post("/api/auth/logout")
        inspector_client(client, db)
        complete_measurement(client, "S-001", 2, 10.0)
        client.post("/api/auth/logout")
        login(client, "admin")

        body = get_stability(client, characteristic_id=2).json()

        assert body["points"][0]["actual"] == 10.0
        assert body["points"][0]["deviation"] is None

    def test_valid_selection_without_measurements_returns_empty_points(self, db, client):
        admin_client(client, db)
        setup_catalog(client)

        response = get_stability(client)

        assert response.status_code == 200
        assert response.json()["points"] == []
        assert response.json()["characteristic"]["code"] == "A1"
