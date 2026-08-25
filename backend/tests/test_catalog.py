import os

import pytest
from sqlalchemy import select

os.environ["DATABASE_URL"] = "sqlite://"

from app.models import (
    Characteristic, Inspection, Measurement, PartRevision, PartType, Piece, utcnow,
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


def create_part_type(client, part_number="BRK-001", description="Brake caliper"):
    return client.post("/api/part-types", json={
        "part_number": part_number, "part_description": description})


def create_characteristic(client, part_type_id=1, control_plan="CP-01", **overrides):
    payload = {"control_plan": control_plan, "name": "Diameter", "unit": "mm",
               "tol_type": "SYMMETRIC", "measurement_method": "Digital caliper",
               "nominal": 10.0, "tol_plus": 0.1}
    payload.update(overrides)
    return client.post(f"/api/part-types/{part_type_id}/characteristics", json=payload)


def place_balloon(client, part_type_id=1, characteristic_id=1, x=0.5, y=0.5):
    return client.post(f"/api/part-types/{part_type_id}/balloons", json={
        "characteristic_id": characteristic_id, "x": x, "y": y})


PNG_BYTES = bytes.fromhex(
    "89504e470d0a1a0a0000000d4948445200000001000000010802000000"
    "907753de0000000c49444154789c63606060000000040001f6173855"
    "0000000049454e44ae426082")


class TestPartTypes:
    def test_admin_creates_and_lists_part_types_with_canonical_names(self, db, client):
        admin_client(client, db)
        response = create_part_type(client)
        assert response.status_code == 201
        assert response.json() == {"id": 1, "part_number": "BRK-001",
                                   "part_description": "Brake caliper",
                                   "image_path": None, "revision_no": 1,
                                   "active": True}
        listing = client.get("/api/part-types")
        assert listing.status_code == 200
        assert [pt["part_number"] for pt in listing.json()] == ["BRK-001"]

    def test_duplicate_part_number_returns_409(self, db, client):
        admin_client(client, db)
        create_part_type(client)
        assert create_part_type(client).status_code == 409

    def test_legacy_code_is_rejected_on_writes(self, db, client):
        admin_client(client, db)
        created = client.post("/api/part-types", json={
            "part_number": "BRK-001", "part_description": "Brake caliper",
            "legacy_code": "LEG-9"})
        assert created.status_code == 422
        assert db.query(PartType).count() == 0

    def test_migrated_legacy_code_is_absent_from_reads(self, db, client):
        admin_client(client, db)
        db.add(PartType(part_number="BRK-001", part_description="Brake caliper",
                        legacy_code="LEG-9", revision_no=1))
        db.commit()
        body = client.get("/api/part-types/1").json()
        assert "legacy_code" not in body
        assert "legacy_code" not in client.get("/api/part-types").json()[0]
        patched = client.patch("/api/part-types/1", json={"legacy_code": "LEG-10"})
        assert patched.status_code == 422

    def test_deactivate_keeps_part_type_listed(self, db, client):
        admin_client(client, db)
        create_part_type(client)
        response = client.patch("/api/part-types/1", json={"active": False})
        assert response.status_code == 200
        assert response.json()["active"] is False
        assert client.get("/api/part-types/1").json()["active"] is False

    def test_patch_unknown_part_type_returns_404(self, db, client):
        admin_client(client, db)
        assert client.patch("/api/part-types/99", json={"active": False}).status_code == 404

    def test_part_metadata_edit_increments_revision_no(self, db, client):
        admin_client(client, db)
        create_part_type(client)
        patched = client.patch("/api/part-types/1",
                               json={"part_description": "Brake caliper v2"})
        assert patched.status_code == 200
        assert patched.json()["revision_no"] == 2
        numbers = db.scalars(select(PartRevision.revision_no)
                             .where(PartRevision.part_type_id == 1)
                             .order_by(PartRevision.revision_no)).all()
        assert numbers == [1, 2]

    @pytest.mark.parametrize("field", ["part_number", "part_description", "active"])
    def test_patch_rejects_null_required_part_fields_without_mutation(
            self, db, client, field):
        admin_client(client, db)
        create_part_type(client)
        before = client.get("/api/part-types/1").json()

        response = client.patch("/api/part-types/1", json={field: None})

        assert response.status_code == 422
        assert client.get("/api/part-types/1").json() == before
        assert db.query(PartRevision).count() == 1


class TestCatalogMutations:
    def test_every_catalog_mutation_increments_revision_no(
            self, db, client, tmp_path, monkeypatch):
        monkeypatch.setenv("IMAGES_DIR", str(tmp_path))
        admin_client(client, db)
        create_part_type(client)                                            # 1
        create_characteristic(client)                                       # 2
        patched = client.patch("/api/characteristics/1", json={"nominal": 12.5})  # 3
        assert patched.status_code == 200
        assert place_balloon(client, characteristic_id=1).status_code == 201  # 4
        assert client.delete("/api/balloons/1").status_code == 204            # 5
        assert client.delete("/api/characteristics/1").status_code == 204     # 6
        upload = client.post("/api/part-types/1/image",
                             files={"file": ("part.png", PNG_BYTES, "image/png")})  # 7
        assert upload.status_code == 200
        assert upload.json()["revision_no"] == 7
        numbers = db.scalars(select(PartRevision.revision_no)
                             .where(PartRevision.part_type_id == 1)
                             .order_by(PartRevision.revision_no)).all()
        assert numbers == [1, 2, 3, 4, 5, 6, 7]


class TestImage:
    def test_upload_png_stores_file_and_serves_it(self, db, client, tmp_path, monkeypatch):
        monkeypatch.setenv("IMAGES_DIR", str(tmp_path))
        admin_client(client, db)
        create_part_type(client)
        upload = client.post("/api/part-types/1/image",
                             files={"file": ("part.png", PNG_BYTES, "image/png")})
        assert upload.status_code == 200
        stored = upload.json()["image_path"]
        assert stored.endswith(".png")
        assert (tmp_path / stored).read_bytes() == PNG_BYTES
        served = client.get("/api/part-types/1/image")
        assert served.status_code == 200
        assert served.content == PNG_BYTES

    def test_invalid_image_content_type_rejected(self, db, client, tmp_path, monkeypatch):
        monkeypatch.setenv("IMAGES_DIR", str(tmp_path))
        admin_client(client, db)
        create_part_type(client)
        response = client.post("/api/part-types/1/image",
                               files={"file": ("notes.txt", b"nope", "text/plain")})
        assert response.status_code == 422
        assert client.get("/api/part-types/1").json()["image_path"] is None


class TestAccess:
    def test_inspector_reads_but_cannot_mutate(self, db, client):
        inspector_client(client, db)
        assert client.get("/api/part-types").status_code == 200
        assert create_part_type(client).status_code == 403
        assert client.patch("/api/part-types/1", json={"active": False}).status_code == 403
        assert client.post("/api/part-types/1/image",
                           files={"file": ("p.png", b"x", "image/png")}).status_code == 403
        assert create_characteristic(client).status_code == 403
        assert client.patch("/api/characteristics/1",
                            json={"nominal": 1.0}).status_code == 403
        assert client.delete("/api/characteristics/1").status_code == 403
        assert place_balloon(client).status_code == 403
        assert client.delete("/api/balloons/1").status_code == 403

    def test_unauthenticated_gets_401(self, db, client):
        assert client.get("/api/part-types").status_code == 401
        assert create_part_type(client).status_code == 401


class TestCharacteristics:
    def test_symmetric_with_independent_tol_minus_derives_asymmetric_bounds(
            self, db, client):
        admin_client(client, db)
        create_part_type(client)
        response = create_characteristic(
            client, tol_plus=0.1, tol_minus=0.3,
            min_limit=-999.0, max_limit=999.0,
        )
        assert response.status_code == 201
        body = response.json()
        assert body["tol_plus"] == 0.1
        assert body["tol_minus"] == 0.3
        assert body["min_limit"] == pytest.approx(9.7)
        assert body["max_limit"] == pytest.approx(10.1)
        stored = db.get(Characteristic, body["id"])
        assert stored.tol_minus == 0.3
        assert stored.min_limit == pytest.approx(9.7)
        assert all(value is not None for value in (
            stored.measurement_method, stored.nominal,
            stored.min_limit, stored.max_limit,
        ))

    def test_symmetric_without_tol_minus_defaults_to_tol_plus(self, db, client):
        admin_client(client, db)
        create_part_type(client)
        response = create_characteristic(client, tol_plus=0.2)
        assert response.status_code == 201
        body = response.json()
        assert body["tol_minus"] == 0.2
        assert body["min_limit"] == pytest.approx(9.8)
        assert body["max_limit"] == pytest.approx(10.2)

    def test_limits_characteristic_requires_explicit_canonical_range(self, db, client):
        admin_client(client, db)
        create_part_type(client)
        response = create_characteristic(
            client, tol_type="LIMITS", nominal=10.0, tol_plus=None,
            min_limit=9.9, max_limit=10.1)
        assert response.status_code == 201
        assert response.json()["nominal"] == 10.0
        assert response.json()["min_limit"] == 9.9
        assert response.json()["max_limit"] == 10.1

    @pytest.mark.parametrize("overrides", [
        {"measurement_method": "   "},
        {"measurement_method": None},
        {"nominal": None},
        {"tol_plus": None},
        {"nominal": "NaN"},
        {"tol_plus": "Infinity"},
        {"tol_plus": -0.1},
        {"tol_minus": -0.1},
        {"tol_minus": "NaN"},
        {"nominal": 1e308, "tol_plus": 1e308},
    ])
    def test_invalid_symmetric_definition_is_rejected_without_persistence(
            self, db, client, overrides):
        admin_client(client, db)
        create_part_type(client)
        assert create_characteristic(client, **overrides).status_code == 422
        assert db.query(Characteristic).count() == 0

    @pytest.mark.parametrize("overrides", [
        {"nominal": None},
        {"min_limit": None},
        {"max_limit": None},
        {"nominal": "NaN"},
        {"min_limit": "-Infinity"},
        {"max_limit": "Infinity"},
        {"nominal": 9.8},
        {"nominal": 10.2},
    ])
    def test_invalid_limits_definition_is_rejected_without_persistence(
            self, db, client, overrides):
        admin_client(client, db)
        create_part_type(client)
        definition = {
            "tol_type": "LIMITS", "nominal": 10.0, "tol_plus": None,
            "min_limit": 9.9, "max_limit": 10.1,
        }
        definition.update(overrides)
        assert create_characteristic(client, **definition).status_code == 422
        assert db.query(Characteristic).count() == 0

    def test_duplicate_control_plan_within_part_type_returns_409(self, db, client):
        admin_client(client, db)
        create_part_type(client)
        create_characteristic(client)
        assert create_characteristic(client).status_code == 409

    def test_patch_switching_to_limits_uses_explicit_range(self, db, client):
        admin_client(client, db)
        create_part_type(client)
        create_characteristic(client)
        response = client.patch("/api/characteristics/1", json={
            "tol_type": "LIMITS", "min_limit": 9.95, "max_limit": 10.15})
        assert response.status_code == 200
        body = response.json()
        assert body["tol_type"] == "LIMITS"
        assert body["tol_plus"] is None
        assert body["tol_minus"] is None
        assert body["min_limit"] == 9.95
        assert body["max_limit"] == 10.15

    def test_admin_edits_characteristic(self, db, client):
        admin_client(client, db)
        create_part_type(client)
        create_characteristic(client, tol_minus=0.3)
        response = client.patch("/api/characteristics/1", json={"nominal": 12.5})
        assert response.status_code == 200
        body = response.json()
        assert body["nominal"] == 12.5
        assert body["tol_plus"] == 0.1
        assert body["tol_minus"] == 0.3
        assert body["min_limit"] == pytest.approx(12.2)
        assert body["max_limit"] == pytest.approx(12.6)

    def test_edit_to_invalid_combination_is_rejected(self, db, client):
        admin_client(client, db)
        create_part_type(client)
        create_characteristic(client)
        assert client.patch(
            "/api/characteristics/1", json={"tol_plus": None}).status_code == 422
        assert client.patch(
            "/api/characteristics/1", json={"measurement_method": None},
        ).status_code == 422
        assert client.patch(
            "/api/characteristics/1", json={"tol_minus": -1.0}).status_code == 422
        db.expire_all()
        stored = db.get(Characteristic, 1)
        assert stored.measurement_method == "Digital caliper"
        assert stored.tol_plus == 0.1
        assert stored.tol_minus == 0.1

    @pytest.mark.parametrize(
        "field", ["control_plan", "measurement_method", "tol_type", "nominal", "sort_order"],
    )
    def test_patch_rejects_null_required_characteristic_fields_without_mutation(
            self, db, client, field):
        admin_client(client, db)
        create_part_type(client)
        created = create_characteristic(client).json()

        response = client.patch("/api/characteristics/1", json={field: None})

        assert response.status_code == 422
        assert client.get("/api/part-types/1/characteristics").json() == [created]
        assert db.query(PartRevision).count() == 2

    def test_admin_deletes_characteristic(self, db, client):
        admin_client(client, db)
        create_part_type(client)
        create_characteristic(client)
        assert client.delete("/api/characteristics/1").status_code == 204
        listing = client.get("/api/part-types/1/characteristics")
        assert listing.json() == []
        assert client.delete("/api/characteristics/1").status_code == 404

    def test_edit_and_removal_preserve_existing_measurement_evidence(self, db, client):
        admin_client(client, db)
        create_part_type(client)
        create_characteristic(client)
        revision = db.scalar(select(PartRevision)
                             .where(PartRevision.part_type_id == 1))
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

        edited = client.patch("/api/characteristics/1", json={
            "nominal": 20.0, "tol_plus": 0.5,
            "measurement_method": "Coordinate measuring machine",
        })
        assert edited.status_code == 200
        assert edited.json()["min_limit"] == pytest.approx(19.9)
        assert edited.json()["max_limit"] == pytest.approx(20.5)
        assert client.delete("/api/characteristics/1").status_code == 204
        assert client.get("/api/part-types/1/characteristics").json() == []

        db.expire_all()
        stored = db.get(Measurement, measurement.id)
        assert {
            "nominal": stored.nominal_snapshot,
            "minimum": stored.min_limit_snapshot,
            "maximum": stored.max_limit_snapshot,
            "method": stored.measurement_method_snapshot,
            "status": stored.status,
        } == {
            "nominal": 10.0,
            "minimum": 9.9,
            "maximum": 10.1,
            "method": "Digital caliper",
            "status": MeasurementStatus.IN_TOLERANCE,
        }
        assert db.get(Characteristic, 1).active is False

    def test_inspector_reads_but_cannot_mutate_characteristics(self, db, client):
        admin_client(client, db)
        create_part_type(client)
        create_characteristic(client)
        client.post("/api/auth/logout")
        inspector_client(client, db)
        assert client.get("/api/part-types/1/characteristics").status_code == 200
        assert create_characteristic(client).status_code == 403
        assert client.patch("/api/characteristics/1", json={"nominal": 1.0}).status_code == 403
        assert client.delete("/api/characteristics/1").status_code == 403


class TestBalloons:
    def test_marker_is_identified_by_control_plan_without_number(self, db, client):
        admin_client(client, db)
        create_part_type(client)
        create_characteristic(client)
        create_characteristic(client, control_plan="CP-02")
        response = place_balloon(client, characteristic_id=2, x=0.25, y=0.75)
        assert response.status_code == 201
        body = response.json()
        assert body == {"id": 1, "part_type_id": 1, "characteristic_id": 2,
                        "x": 0.25, "y": 0.75}
        listing = client.get("/api/part-types/1/balloons")
        assert listing.status_code == 200
        assert listing.json() == [body]
        characteristics = client.get("/api/part-types/1/characteristics").json()
        marker = next(c for c in characteristics
                      if c["id"] == body["characteristic_id"])
        assert marker["control_plan"] == "CP-02"

    def test_characteristic_can_hold_only_one_balloon(self, db, client):
        admin_client(client, db)
        create_part_type(client)
        create_characteristic(client)
        assert place_balloon(client, characteristic_id=1).status_code == 201
        assert place_balloon(client, characteristic_id=1,
                             x=0.2, y=0.2).status_code == 409

    def test_coordinates_outside_image_bounds_are_rejected(self, db, client):
        admin_client(client, db)
        create_part_type(client)
        create_characteristic(client)
        assert place_balloon(client, x=1.5).status_code == 422
        assert place_balloon(client, y=-0.1).status_code == 422

    def test_balloon_for_missing_characteristic_returns_404(self, db, client):
        admin_client(client, db)
        create_part_type(client)
        assert place_balloon(client, characteristic_id=99).status_code == 404

    def test_delete_balloon_frees_characteristic(self, db, client):
        admin_client(client, db)
        create_part_type(client)
        create_characteristic(client)
        place_balloon(client, characteristic_id=1)
        assert client.delete("/api/balloons/1").status_code == 204
        assert place_balloon(client, characteristic_id=1).status_code == 201

    def test_inspector_reads_but_cannot_mutate_balloons(self, db, client):
        admin_client(client, db)
        create_part_type(client)
        create_characteristic(client)
        client.post("/api/auth/logout")
        inspector_client(client, db)
        assert client.get("/api/part-types/1/balloons").status_code == 200
        assert place_balloon(client).status_code == 403
        assert client.delete("/api/balloons/1").status_code == 403
