"""Persisted deviation history preserves queue defaults and visibility rules."""
import os

os.environ["DATABASE_URL"] = "sqlite://"

import pytest
from sqlalchemy import select

from app.models import Deviation, DeviationAuditEvent
from app.services.disposition import pending_queue
from tests.conftest import login, make_user
from tests.test_disposition import (
    annul, create_manual, resolve_deviation, seed_pending_deviation,
)
from tests.test_inspection import record, start


HISTORY_URL = "/api/deviations?include_resolved=true"


def test_default_and_explicit_false_keep_only_pending_items_in_mixed_groups(db, client):
    seed_pending_deviation(client, db)
    client.post("/api/auth/logout")
    login(client, "raul")
    manual = create_manual(client, measurement_id=1)
    assert manual.status_code == 201
    client.post("/api/auth/logout")
    login(client, "admin")
    assert resolve_deviation(client).status_code == 200

    for url in ("/api/deviations", "/api/deviations?include_resolved=false"):
        response = client.get(url)
        assert response.status_code == 200
        groups = response.json()["groups"]
        assert len(groups) == 1
        assert [item["id"] for item in groups[0]["deviations"]] == [manual.json()["id"]]
        assert [item["status"] for item in groups[0]["deviations"]] == ["PENDING"]
        assert [item["id"] for item in groups[0]["measurements"]] == [1]

    groups = client.get(HISTORY_URL).json()["groups"]
    assert [item["status"] for item in groups[0]["deviations"]] == ["ACCEPTED", "PENDING"]
    assert [item["id"] for item in groups[0]["measurements"]] == [2, 1]
    assert [item.status for item in pending_queue(db)[0]["deviations"]] == ["PENDING"]
    assert [item.status for item in pending_queue(db, include_resolved=True)[0]["deviations"]] == ["ACCEPTED", "PENDING"]


@pytest.mark.parametrize("action", ["accept", "reject"])
def test_resolved_only_history_reloads_persisted_snapshots_and_rejection_reason(db, client, action):
    seed_pending_deviation(client, db)
    resolution = resolve_deviation(client, action=action, rejection_reason="  Surface damage  ")
    assert resolution.status_code == 200
    saved = resolution.json()
    assert client.patch("/api/approved-deviations/1", json={
        "code": "AD-CHANGED", "description": "New catalog meaning", "active": False,
    }).status_code == 200
    db.expire_all()

    assert client.get("/api/deviations").json()["groups"] == []
    response = client.get(HISTORY_URL)
    assert response.status_code == 200
    groups = response.json()["groups"]
    assert len(groups) == 1
    assert len(groups[0]["deviations"]) == 1
    historical = groups[0]["deviations"][0]
    assert historical == saved
    assert historical["created_at"] is not None
    assert historical["resolved_at"] is not None
    assert historical["resolved_by"] == 1
    if action == "accept":
        assert historical["approved_deviation_code_snapshot"] == "AD-001"
        assert historical["approved_deviation_description_snapshot"] == "Use as-is"
        assert historical["rejection_reason"] is None
        assert groups[0]["measurements"][0]["status"] == "DEVIATION_ACCEPTED"
    else:
        assert historical["rejection_reason"] == "Surface damage"
        assert historical["approved_deviation_code_snapshot"] is None
        assert groups[0]["measurements"][0]["status"] == "REJECTED"
    assert db.query(DeviationAuditEvent).count() == 1


@pytest.mark.parametrize("viewer", ["admin", "raul", "other-inspector"])
def test_history_remains_shared_to_authenticated_users_without_granting_resolution(db, client, viewer):
    seed_pending_deviation(client, db)
    assert resolve_deviation(client).status_code == 200
    if viewer == "other-inspector":
        make_user(db, viewer)
    client.post("/api/auth/logout")
    assert login(client, viewer).status_code == 200

    response = client.get(HISTORY_URL)
    assert response.status_code == 200
    assert response.json()["groups"][0]["inspection"]["inspector"] == "raul"
    assert response.json()["groups"][0]["deviations"][0]["status"] == "ACCEPTED"
    if viewer != "admin":
        assert resolve_deviation(client, action="reject").status_code == 403
    if viewer == "other-inspector":
        assert client.post("/api/inspections/1/reports").status_code == 403
        assert client.get("/api/reports").json() == []


@pytest.mark.parametrize("url", ["/api/deviations", HISTORY_URL])
def test_queue_and_history_require_authentication(client, url):
    assert client.get(url).status_code == 401


def test_history_rejects_invalid_boolean_query(db, client):
    seed_pending_deviation(client, db)
    assert client.get("/api/deviations?include_resolved=invalid").status_code == 422


@pytest.mark.parametrize("status", ["PENDING", "ACCEPTED", "REJECTED"])
def test_annulled_auto_items_stay_suppressed_while_manual_history_is_retained(db, client, status):
    seed_pending_deviation(client, db)
    client.post("/api/auth/logout")
    login(client, "raul")
    manual = create_manual(client, measurement_id=1)
    assert manual.status_code == 201
    assert start(client, characteristic_ids=(1,)).status_code == 201
    assert record(client, inspection_id=2, actual=10.5).status_code == 201
    assert client.post("/api/inspections/2/complete").status_code == 200
    client.post("/api/auth/logout")
    login(client, "admin")
    if status != "PENDING":
        action = "accept" if status == "ACCEPTED" else "reject"
        for deviation in db.scalars(select(Deviation).order_by(Deviation.id)).all():
            assert resolve_deviation(client, deviation.id, action=action).status_code == 200
    assert annul(client, inspection_id=1).status_code == 200
    assert annul(client, inspection_id=2).status_code == 200
    db.expire_all()

    groups = client.get(HISTORY_URL).json()["groups"]
    assert [group["inspection"]["id"] for group in groups] == [1]
    assert groups[0]["inspection"]["annulled_at"] is not None
    assert [(item["id"], item["origin"], item["status"]) for item in groups[0]["deviations"]] == [
        (manual.json()["id"], "MANUAL", status),
    ]
    assert [item["id"] for item in groups[0]["measurements"]] == [1]
    default_groups = client.get("/api/deviations").json()["groups"]
    assert default_groups == (groups if status == "PENDING" else [])
    assert db.query(Deviation).count() == 3
    assert set(db.scalars(select(Deviation.status)).all()) == {status}


def test_history_orders_resolved_and_pending_groups_together_without_empty_inspections(db, client):
    seed_pending_deviation(client, db)
    assert resolve_deviation(client).status_code == 200
    client.post("/api/auth/logout")
    login(client, "raul")
    assert start(client, characteristic_ids=(1,)).status_code == 201
    assert record(client, inspection_id=2, actual=10.5).status_code == 201
    assert client.post("/api/inspections/2/complete").status_code == 200
    assert start(client, characteristic_ids=(1,)).status_code == 201
    assert record(client, inspection_id=3, actual=10.0).status_code == 201
    assert client.post("/api/inspections/3/complete").status_code == 200

    assert [group["inspection"]["id"] for group in client.get(HISTORY_URL).json()["groups"]] == [2, 1]
    assert [group["inspection"]["id"] for group in client.get("/api/deviations").json()["groups"]] == [2]
