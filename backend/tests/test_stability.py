"""Stability analysis tests (spec: stability-analysis)."""
from datetime import datetime, timezone

import pytest

from app.models import Inspection
from tests.conftest import login
from tests.test_inspection import (
    admin_client, inspector_client, record, start,
)


def setup_catalog(client):
    client.post("/api/part-types", json={
        "part_number": "BRK-001", "part_description": "Bracket",
    })
    client.post("/api/part-types/1/characteristics", json={
        "control_plan": "A1", "name": "Diameter", "unit": "mm",
        "measurement_method": "Digital caliper",
        "tol_type": "SYMMETRIC", "nominal": 10.0, "tol_plus": 0.1,
    })
    client.post("/api/part-types/1/characteristics", json={
        "control_plan": "L1", "name": "Width", "unit": "mm",
        "measurement_method": "Coordinate measuring machine",
        "tol_type": "LIMITS", "nominal": 10.0,
        "min_limit": 9.5, "max_limit": 10.8,
    })


def complete_measurement(client, characteristic_id, actual):
    inspection_id = start(
        client, characteristic_ids=(characteristic_id,),
    ).json()["id"]
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
        complete_measurement(client, 1, 10.05)
        complete_measurement(client, 1, 9.95)
        db.get(Inspection, 1).completed_at = datetime(2026, 1, 2, tzinfo=timezone.utc)
        db.get(Inspection, 2).completed_at = datetime(2026, 1, 1, tzinfo=timezone.utc)
        db.commit()
        client.post("/api/auth/logout")
        login(client, "admin")

        response = get_stability(client)

        assert response.status_code == 200
        body = response.json()
        assert body["characteristic"] == {
            "control_plan": "A1", "name": "Diameter", "unit": "mm",
            "nominal": 10.0, "lower_limit": pytest.approx(9.9),
            "upper_limit": pytest.approx(10.1),
        }
        assert [point["inspection_id"] for point in body["points"]] == [2, 1]
        assert body["points"][0] == {
            "inspection_id": 2,
            "completed_at": "2026-01-01T00:00:00", "actual": 9.95,
            "deviation": pytest.approx(-0.05), "status": "IN_TOLERANCE",
        }

    def test_limits_measurement_uses_canonical_nominal_deviation(self, db, client):
        admin_client(client, db)
        setup_catalog(client)
        client.post("/api/auth/logout")
        inspector_client(client, db)
        complete_measurement(client, 2, 10.0)
        client.post("/api/auth/logout")
        login(client, "admin")

        body = get_stability(client, characteristic_id=2).json()

        assert body["points"][0]["actual"] == 10.0
        assert body["points"][0]["deviation"] == 0.0

    def test_valid_selection_without_measurements_returns_empty_points(self, db, client):
        admin_client(client, db)
        setup_catalog(client)

        response = get_stability(client)

        assert response.status_code == 200
        assert response.json()["points"] == []
        assert response.json()["characteristic"]["control_plan"] == "A1"


class TestStabilityGuards:
    def test_inspector_is_forbidden(self, db, client):
        admin_client(client, db)
        setup_catalog(client)
        client.post("/api/auth/logout")
        inspector_client(client, db)

        assert get_stability(client).status_code == 403

    def test_characteristic_from_another_part_type_is_rejected(self, db, client):
        admin_client(client, db)
        setup_catalog(client)
        client.post("/api/part-types", json={
            "part_number": "BRK-002", "part_description": "Bracket",
        })
        foreign = client.post("/api/part-types/2/characteristics", json={
            "control_plan": "B1", "measurement_method": "Micrometer",
            "tol_type": "SYMMETRIC",
            "nominal": 5.0, "tol_plus": 0.2,
        }).json()

        response = get_stability(client, part_type_id=1,
                                 characteristic_id=foreign["id"])

        assert response.status_code == 422

    def test_asymmetric_limits_remain_distinct(self, db, client):
        admin_client(client, db)
        setup_catalog(client)

        characteristic = get_stability(client, characteristic_id=2).json()[
            "characteristic"]

        assert characteristic["nominal"] == 10.0
        assert characteristic["lower_limit"] == 9.5
        assert characteristic["upper_limit"] == 10.8

    def test_annulled_inspection_is_excluded(self, db, client):
        admin_client(client, db)
        setup_catalog(client)
        client.post("/api/auth/logout")
        inspector_client(client, db)
        complete_measurement(client, 1, 10.0)
        complete_measurement(client, 1, 10.05)
        client.post("/api/auth/logout")
        login(client, "admin")
        assert client.post("/api/inspections/2/annul", json={
            "reason": "Fixture setup error",
        }).status_code == 200

        points = get_stability(client).json()["points"]

        assert [point["inspection_id"] for point in points] == [1]
        assert all("serial" not in point for point in points)
