import json; import pytest; from app.models import Inspection; from app.services.report import render_report_html; from tests.conftest import login, make_user
def catalog(client, db):
    make_user(db, "admin", "admin"); login(client, "admin"); part = client.post("/api/part-types", json={"code": "P1", "name": "Pump", "description": "Body"}).json()
    [client.post(f"/api/part-types/{part['id']}/characteristics", json={"code": code, "tol_type": "SYMMETRIC", "nominal": 10, "tol_plus": 1}) for code in ("A", "B")]; return part
def test_part_fields_are_required_and_editable(db, client):
    make_user(db, "admin", "admin"); login(client, "admin"); assert client.post("/api/part-types", json={"code": "P1"}).status_code == 422; assert client.post("/api/part-types", json={"code": "P1", "name": "Pump", "description": "Body"}).status_code == 201; assert client.patch("/api/part-types/1", json={"name": "Valve", "description": "Stem"}).json()["name"] == "Valve"
@pytest.mark.parametrize("payload", [{"code": "N", "tol_type": "SYMMETRIC", "nominal": 1, "tol_plus": -1}])
def test_invalid_catalog_values_are_rejected(db, client, tmp_path, monkeypatch, payload):
    part = catalog(client, db); monkeypatch.setenv("IMAGES_DIR", str(tmp_path)); assert client.post(f"/api/part-types/{part['id']}/characteristics", json=payload).status_code == 422
    assert client.post(f"/api/part-types/{part['id']}/image", files={"file": ("x.png", b"\x89PNG\r\n\x1a\njunk", "image/png")}).status_code == 422
def test_selection_ownership_and_finite_measurements_are_enforced(db, client):
    part = catalog(client, db); make_user(db, "owner"); make_user(db, "other")
    client.post("/api/auth/logout"); login(client, "owner")
    started = client.post("/api/inspections", json={"part_type_id": part["id"], "serial": "S1", "characteristic_ids": [1]}).json()
    assert client.get(f"/api/inspections/{started['id']}").json()["characteristic_ids"] == [1]; assert client.post(f"/api/inspections/{started['id']}/measurements", json={"characteristic_id": 2, "actual_value": 10}).status_code == 422
    assert client.post(f"/api/inspections/{started['id']}/measurements", content='{"characteristic_id":1,"actual_value":NaN}', headers={"content-type": "application/json"}).status_code == 422
    client.post("/api/auth/logout"); login(client, "other"); assert client.post(f"/api/inspections/{started['id']}/measurements", json={"characteristic_id": 1, "actual_value": 10}).status_code == 403; assert client.post(f"/api/inspections/{started['id']}/complete").status_code == 403
    client.post("/api/auth/logout"); login(client, "admin"); assert client.post(f"/api/inspections/{started['id']}/measurements", json={"characteristic_id": 1, "actual_value": 10}).status_code == 201; assert client.post(f"/api/inspections/{started['id']}/complete").status_code == 200
    assert client.delete("/api/characteristics/1").status_code == 204; assert [c["code"] for c in client.get(f"/api/part-types/{part['id']}/characteristics").json()] == ["B"]
    assert client.post("/api/inspections", json={"part_type_id": part["id"], "serial": "S2", "characteristic_ids": [1]}).status_code == 422; assert "A" in render_report_html(db, db.get(Inspection, started["id"]))
@pytest.mark.parametrize("field,value", [(f, v) for f in ("nominal", "tol_plus", "max_limit") for v in ("NaN", "Infinity")] + [("min_limit", v) for v in ("NaN", "-Infinity")])
def test_non_finite_characteristic_numbers_are_rejected(db, client, field, value):
    part = catalog(client, db); payload = {"code": "C", "tol_type": "LIMITS", "nominal": 1, "tol_plus": 1, "min_limit": 0, "max_limit": 2}; payload[field] = float(value)
    assert client.post(f"/api/part-types/{part['id']}/characteristics", content=json.dumps(payload), headers={"content-type": "application/json"}).status_code == 422; assert client.patch("/api/characteristics/1", content=json.dumps({field: float(value)}), headers={"content-type": "application/json"}).status_code == 422
