import json
import os
from io import BytesIO

import pytest
from PIL import Image
from sqlalchemy import select

os.environ["DATABASE_URL"] = "sqlite://"

from app.models import (
    Characteristic, Inspection, Measurement, PartRevision, Piece, utcnow,
)
from app.services.status import InspectionStatus, MeasurementStatus
from tests.conftest import login, make_user


def admin_client(client, db):
    make_user(db, "admin", role="admin")
    login(client, "admin")
    return client


def inspector_client(client, db):
    make_user(db, "raul", "inspector")
    login(client, "raul")
    return client


def create_part_type(client, part_number="BRK-001"):
    return client.post("/api/part-types", json={
        "part_number": part_number, "part_description": "Brake caliper"})


def create_characteristic(client, part_type_id=1, control_plan="CP-01", **overrides):
    payload = {"control_plan": control_plan, "name": "Diameter", "unit": "mm",
               "tol_type": "SYMMETRIC", "measurement_method": "Digital caliper",
               "nominal": 10.0, "tol_plus": 0.1, "tol_minus": 0.3}
    payload.update(overrides)
    return client.post(f"/api/part-types/{part_type_id}/characteristics", json=payload)


def revisions(db, part_type_id=1):
    return db.scalars(select(PartRevision)
                      .where(PartRevision.part_type_id == part_type_id)
                      .order_by(PartRevision.revision_no)).all()


def definitions(db, part_type_id=1):
    return {revision.revision_no: json.loads(revision.definition_json)
            for revision in revisions(db, part_type_id)}


def png_bytes(color: tuple[int, int, int]) -> bytes:
    output = BytesIO()
    Image.new("RGB", (1, 1), color).save(output, format="PNG")
    return output.getvalue()


class TestRevisionSnapshots:
    def test_creation_records_full_definition_revision_1(self, db, client):
        admin_client(client, db)
        create_part_type(client)
        create_characteristic(client)
        create_characteristic(client, control_plan="CP-02", tol_minus=None)
        assert client.post("/api/part-types/1/balloons", json={
            "characteristic_id": 2, "x": 0.25, "y": 0.75}).status_code == 201

        assert client.get("/api/part-types/1").json()["revision_no"] == 4
        history = definitions(db)
        assert list(history) == [1, 2, 3, 4]
        creation = history[1]
        assert creation["part_number"] == "BRK-001"
        assert creation["part_description"] == "Brake caliper"
        assert creation["legacy_code"] is None
        assert creation["image_path"] is None
        assert creation["active"] is True
        assert creation["characteristics"] == []
        definition = history[4]
        assert definition["part_number"] == "BRK-001"
        assert definition["part_description"] == "Brake caliper"
        assert definition["legacy_code"] is None
        assert definition["image_path"] is None
        assert definition["active"] is True
        assert [entry["control_plan"] for entry in definition["characteristics"]] == [
            "CP-01", "CP-02"]
        first, second = definition["characteristics"]
        assert first["measurement_method"] == "Digital caliper"
        assert first["nominal"] == 10.0
        assert first["tol_plus"] == 0.1
        assert first["tol_minus"] == 0.3
        assert first["min_limit"] == pytest.approx(9.7)
        assert first["max_limit"] == pytest.approx(10.1)
        assert first["balloon"] is None
        assert second["tol_minus"] == 0.1
        assert second["balloon"] == {"x": 0.25, "y": 0.75}

    def test_snapshots_capture_definition_at_mutation_time(self, db, client):
        admin_client(client, db)
        create_part_type(client)
        create_characteristic(client)
        edited = client.patch("/api/characteristics/1", json={"nominal": 20.0})
        assert edited.status_code == 200
        history = definitions(db)
        assert list(history) == [1, 2, 3]
        assert history[1]["characteristics"] == []
        assert history[2]["characteristics"][0]["nominal"] == 10.0
        assert history[3]["characteristics"][0]["nominal"] == 20.0


class TestRevisionImmutability:
    def test_earlier_revisions_are_never_rewritten(self, db, client):
        admin_client(client, db)
        create_part_type(client)
        create_characteristic(client)
        client.patch("/api/part-types/1", json={"part_description": "v2"})
        create_characteristic(client, control_plan="CP-02")
        original = [(revision.revision_no, revision.definition_json, revision.created_at)
                    for revision in revisions(db)]

        client.patch("/api/characteristics/1", json={"nominal": 20.0})
        client.delete("/api/characteristics/2")

        history = revisions(db)
        assert [revision.revision_no for revision in history] == [1, 2, 3, 4, 5, 6]
        assert [(revision.revision_no, revision.definition_json, revision.created_at)
                for revision in history[:4]] == original

    def test_same_format_image_replacement_preserves_historical_bytes(
            self, db, client, tmp_path, monkeypatch):
        monkeypatch.setenv("IMAGES_DIR", str(tmp_path))
        admin_client(client, db)
        create_part_type(client)
        old_image = png_bytes((255, 0, 0))
        new_image = png_bytes((0, 0, 255))

        first = client.post(
            "/api/part-types/1/image",
            files={"file": ("part.png", old_image, "image/png")},
        )
        old_path = first.json()["image_path"]
        old_revision = definitions(db)[2]
        second = client.post(
            "/api/part-types/1/image",
            files={"file": ("part.png", new_image, "image/png")},
        )
        new_path = second.json()["image_path"]

        assert first.status_code == 200
        assert second.status_code == 200
        assert old_path != new_path
        assert old_revision["image_path"] == old_path
        assert definitions(db)[2] == old_revision
        assert definitions(db)[3]["image_path"] == new_path
        assert (tmp_path / old_path).read_bytes() == old_image
        assert (tmp_path / new_path).read_bytes() == new_image
        assert client.get("/api/part-types/1/image").content == new_image


class TestRestore:
    def test_restore_copies_target_definition_as_a_new_revision(self, db, client):
        admin_client(client, db)
        create_part_type(client)                                    # revision 1
        create_characteristic(client)                               # 2
        assert client.post("/api/part-types/1/balloons", json={
            "characteristic_id": 1, "x": 0.25, "y": 0.75}).status_code == 201  # 3
        client.patch("/api/characteristics/1", json={"nominal": 20.0})          # 4
        create_characteristic(client, control_plan="CP-02")                     # 5
        original = [(revision.revision_no, revision.definition_json)
                    for revision in revisions(db)]

        restored = client.post("/api/part-types/1/revisions/3/restore")
        assert restored.status_code == 200
        assert restored.json()["revision_no"] == 6

        assert client.get("/api/part-types/1").json()["revision_no"] == 6
        live = client.get("/api/part-types/1/characteristics").json()
        assert [entry["control_plan"] for entry in live] == ["CP-01"]
        assert live[0]["nominal"] == 10.0
        balloons = client.get("/api/part-types/1/balloons").json()
        assert [(balloon["characteristic_id"], balloon["x"], balloon["y"])
                for balloon in balloons] == [(1, 0.25, 0.75)]

        history = revisions(db)
        assert [(revision.revision_no, revision.definition_json)
                for revision in history[:5]] == original
        assert history[5].definition_json == history[2].definition_json

    def test_restore_deactivates_measured_characteristic_absent_from_target(
            self, db, client):
        admin_client(client, db)
        create_part_type(client)                                  # revision 1
        create_characteristic(client)                             # 2 (CP-01)
        create_characteristic(client, control_plan="CP-02")       # 3
        revision = revisions(db)[-1]
        piece = Piece(part_type_id=1)
        db.add(piece)
        db.flush()
        inspection = Inspection(
            piece_id=piece.id, part_revision_id=revision.id, inspector_id=1,
            selected_characteristic_ids="2", status=InspectionStatus.CONFORMING,
            completed_at=utcnow(),
        )
        db.add(inspection)
        db.flush()
        db.add(Measurement(
            inspection_id=inspection.id, characteristic_id=2, actual_value=10.0,
            nominal_snapshot=10.0, min_limit_snapshot=9.9, max_limit_snapshot=10.1,
            measurement_method_snapshot="Digital caliper",
            status=MeasurementStatus.IN_TOLERANCE,
        ))
        db.commit()

        assert client.post("/api/part-types/1/revisions/2/restore").status_code == 200
        live = client.get("/api/part-types/1/characteristics").json()
        assert [entry["control_plan"] for entry in live] == ["CP-01"]
        removed = db.get(Characteristic, 2)
        assert removed.active is False
        db.expire_all()
        assert db.get(Measurement, 1).characteristic_id == 2

    def test_restore_rebuilds_balloon_state_from_target(self, db, client):
        admin_client(client, db)
        create_part_type(client)                                   # revision 1
        create_characteristic(client)                              # 2
        assert client.post("/api/part-types/1/balloons", json={
            "characteristic_id": 1, "x": 0.25, "y": 0.75}).status_code == 201  # 3
        assert client.delete("/api/balloons/1").status_code == 204             # 4

        assert client.post("/api/part-types/1/revisions/3/restore").status_code == 200
        balloons = client.get("/api/part-types/1/balloons").json()
        assert [(balloon["characteristic_id"], balloon["x"], balloon["y"])
                for balloon in balloons] == [(1, 0.25, 0.75)]

        assert client.post("/api/part-types/1/revisions/4/restore").status_code == 200
        assert client.get("/api/part-types/1/balloons").json() == []

    def test_restore_unknown_revision_returns_404(self, db, client):
        admin_client(client, db)
        create_part_type(client)
        assert client.post("/api/part-types/1/revisions/9/restore").status_code == 404
        assert client.post("/api/part-types/9/revisions/1/restore").status_code == 404

    def test_restore_is_admin_only_but_listing_is_authenticated(self, db, client):
        admin_client(client, db)
        create_part_type(client)
        client.post("/api/auth/logout")
        inspector_client(client, db)
        assert client.get("/api/part-types/1/revisions").status_code == 200
        restore = client.post("/api/part-types/1/revisions/1/restore")
        assert restore.status_code == 403
        client.post("/api/auth/logout")
        assert client.get("/api/part-types/1/revisions").status_code == 401
        assert client.post("/api/part-types/1/revisions/1/restore").status_code == 401


class TestRevisionListing:
    def test_revision_history_is_listed_in_order(self, db, client):
        admin_client(client, db)
        create_part_type(client)
        client.patch("/api/part-types/1", json={"part_description": "v2"})
        listing = client.get("/api/part-types/1/revisions")
        assert listing.status_code == 200
        body = listing.json()
        assert [revision["revision_no"] for revision in body] == [1, 2]
        assert body[0]["part_type_id"] == 1
        assert body[0]["created_by"] == 1
        assert json.loads(body[0]["definition_json"])["part_description"] == "Brake caliper"
        assert json.loads(body[1]["definition_json"])["part_description"] == "v2"

    def test_listing_unknown_part_type_returns_404(self, db, client):
        admin_client(client, db)
        assert client.get("/api/part-types/9/revisions").status_code == 404


class TestCompletedInspectionEvidence:
    def test_restore_leaves_completed_inspection_evidence_unchanged(self, db, client):
        admin_client(client, db)
        create_part_type(client)
        create_characteristic(client)
        revision = revisions(db)[-1]
        piece = Piece(part_type_id=1)
        db.add(piece)
        db.flush()
        inspection = Inspection(
            piece_id=piece.id, part_revision_id=revision.id, inspector_id=1,
            selected_characteristic_ids="1", status=InspectionStatus.CONFORMING,
            completed_at=utcnow(),
        )
        db.add(inspection)
        db.flush()
        measurement = Measurement(
            inspection_id=inspection.id, characteristic_id=1, actual_value=10.05,
            nominal_snapshot=10.0, min_limit_snapshot=9.9, max_limit_snapshot=10.1,
            measurement_method_snapshot="Digital caliper", deviation=0.05,
            status=MeasurementStatus.IN_TOLERANCE,
        )
        db.add(measurement)
        db.commit()
        completed_at = inspection.completed_at

        client.patch("/api/characteristics/1", json={"nominal": 20.0})
        restored = client.post("/api/part-types/1/revisions/2/restore")
        assert restored.status_code == 200

        db.expire_all()
        stored = db.get(Measurement, measurement.id)
        assert stored.actual_value == 10.05
        assert stored.nominal_snapshot == 10.0
        assert stored.min_limit_snapshot == 9.9
        assert stored.max_limit_snapshot == 10.1
        assert stored.measurement_method_snapshot == "Digital caliper"
        assert stored.status == MeasurementStatus.IN_TOLERANCE
        assert stored.characteristic_id == 1
        reloaded = db.get(Inspection, inspection.id)
        assert reloaded.part_revision_id == revision.id
        assert reloaded.inspector_id == 1
        assert reloaded.completed_at == completed_at.replace(tzinfo=None)
