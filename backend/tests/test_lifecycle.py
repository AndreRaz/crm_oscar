"""Full API lifecycle integration test across every v1 backend capability."""
import pytest

from tests.conftest import login, make_user


def test_full_inspection_lifecycle_enforces_roles_and_immutable_records(db, client):
    make_user(db, "admin", role="admin")

    assert login(client, "admin").status_code == 200
    assert client.get("/api/auth/me").json()["role"] == "admin"
    for username in ("inspector", "observer"):
        response = client.post("/api/users", json={
            "username": username, "password": "secret123", "role": "inspector",
        })
        assert response.status_code == 201

    part_type = client.post("/api/part-types", json={"code": "VALVE-001"})
    assert part_type.status_code == 201
    part_type_id = part_type.json()["id"]
    characteristic = client.post(
        f"/api/part-types/{part_type_id}/characteristics",
        json={
            "code": "D1", "name": "Diameter", "unit": "mm",
            "tol_type": "SYMMETRIC", "nominal": 10.0, "tol_plus": 0.1,
        },
    )
    assert characteristic.status_code == 201
    characteristic_id = characteristic.json()["id"]
    balloon = client.post(
        f"/api/part-types/{part_type_id}/balloons",
        json={"number": 1, "characteristic_id": characteristic_id, "x": 0.25, "y": 0.75},
    )
    assert balloon.status_code == 201

    assert client.post("/api/auth/logout").status_code == 200
    assert login(client, "inspector").status_code == 200
    assert client.get(f"/api/part-types/{part_type_id}/balloons").json()[0]["number"] == 1
    assert client.patch(f"/api/part-types/{part_type_id}", json={"active": False}).status_code == 403

    inspection = client.post("/api/inspections", json={
        "part_type_id": part_type_id,
        "serial": "SERIAL-001",
        "characteristic_ids": [characteristic_id],
    })
    assert inspection.status_code == 201
    inspection_id = inspection.json()["id"]
    measurement = client.post(f"/api/inspections/{inspection_id}/measurements", json={
        "characteristic_id": characteristic_id, "actual_value": 10.5,
    })
    assert measurement.status_code == 201
    measurement_id = measurement.json()["id"]
    assert measurement.json()["status"] == "PENDING"
    assert measurement.json()["nominal_snapshot"] == 10.0

    completed = client.post(f"/api/inspections/{inspection_id}/complete")
    assert completed.status_code == 200
    assert completed.json()["status"] == "PENDING"
    assert client.post(f"/api/inspections/{inspection_id}/measurements", json={
        "characteristic_id": characteristic_id, "actual_value": 10.0,
    }).status_code == 409
    assert client.post(f"/api/inspections/{inspection_id}/complete").status_code == 409
    assert client.post(f"/api/measurements/{measurement_id}/disposition", json={
        "action": "accept", "text": "Use as is",
    }).status_code == 403
    assert client.get("/api/stability", params={
        "part_type_id": part_type_id, "characteristic_id": characteristic_id,
    }).status_code == 403

    client.post("/api/auth/logout")
    login(client, "admin")
    queue = client.get("/api/deviations").json()["groups"]
    assert queue[0]["measurements"][0]["id"] == measurement_id
    disposition = client.post(f"/api/measurements/{measurement_id}/disposition", json={
        "action": "accept", "text": "Approved concession",
    })
    assert disposition.status_code == 200
    assert disposition.json()["status"] == "DEVIATION_ACCEPTED"
    assert client.get(f"/api/inspections/{inspection_id}").json()["status"] == (
        "ACCEPTED_WITH_DEVIATIONS"
    )

    client.patch(f"/api/characteristics/{characteristic_id}", json={
        "nominal": 20.0, "tol_plus": 0.2,
    })
    stored = client.get(f"/api/inspections/{inspection_id}").json()["measurements"][0]
    assert stored["nominal_snapshot"] == 10.0
    assert stored["deviation"] == pytest.approx(0.5)

    report = client.get(f"/api/inspections/{inspection_id}/report.pdf")
    assert report.status_code == 200
    assert report.headers["content-type"] == "application/pdf"
    assert report.content.startswith(b"%PDF")

    client.post("/api/auth/logout")
    login(client, "observer")
    assert client.get(f"/api/inspections/{inspection_id}/report.pdf").status_code == 403
    client.post("/api/auth/logout")
    login(client, "admin")
    stability = client.get("/api/stability", params={
        "part_type_id": part_type_id, "characteristic_id": characteristic_id,
    })
    assert stability.status_code == 200
    assert stability.json()["characteristic"]["nominal"] == 20.0
    assert stability.json()["points"] == [{
        "inspection_id": inspection_id,
        "serial": "SERIAL-001",
        "completed_at": completed.json()["completed_at"],
        "actual": 10.5,
        "deviation": pytest.approx(0.5),
        "status": "DEVIATION_ACCEPTED",
    }]
