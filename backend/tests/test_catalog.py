from tests.conftest import login, make_user


def admin_client(client, db):
    make_user(db, "admin", role="admin")
    login(client, "admin")
    return client


def inspector_client(client, db):
    make_user(db, "raul", "inspector")
    login(client, "raul")
    return client


def create_part_type(client, code="BRK-001"):
    return client.post("/api/part-types", json={"code": code})


def create_characteristic(client, part_type_id=1, code="A1", **overrides):
    payload = {"code": code, "name": "Diameter", "unit": "mm", "tol_type": "SYMMETRIC",
               "nominal": 10.0, "tol_plus": 0.1}
    payload.update(overrides)
    return client.post(f"/api/part-types/{part_type_id}/characteristics", json=payload)


class TestPartTypes:
    def test_admin_creates_and_lists_part_types(self, db, client):
        admin_client(client, db)
        response = create_part_type(client)
        assert response.status_code == 201
        assert response.json() == {"id": 1, "code": "BRK-001", "image_path": None, "active": True}
        listing = client.get("/api/part-types")
        assert listing.status_code == 200
        assert [pt["code"] for pt in listing.json()] == ["BRK-001"]

    def test_duplicate_code_returns_409(self, db, client):
        admin_client(client, db)
        create_part_type(client)
        assert create_part_type(client).status_code == 409

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


class TestImage:
    def test_upload_png_stores_file_and_serves_it(self, db, client, tmp_path, monkeypatch):
        monkeypatch.setenv("IMAGES_DIR", str(tmp_path))
        admin_client(client, db)
        create_part_type(client)
        payload = bytes.fromhex(
            "89504e470d0a1a0a0000000d4948445200000001000000010806000000"
            "1f15c4890000000d49444154789c626001000000ffff030000060005"
            "57bfabd40000000049454e44ae426082")
        upload = client.post("/api/part-types/1/image",
                             files={"file": ("part.png", payload, "image/png")})
        assert upload.status_code == 200
        stored = upload.json()["image_path"]
        assert stored.endswith(".png")
        assert (tmp_path / stored).read_bytes() == payload
        served = client.get("/api/part-types/1/image")
        assert served.status_code == 200
        assert served.content == payload

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

    def test_unauthenticated_gets_401(self, db, client):
        assert client.get("/api/part-types").status_code == 401
        assert create_part_type(client).status_code == 401


class TestCharacteristics:
    def test_symmetric_characteristic_is_created(self, db, client):
        admin_client(client, db)
        create_part_type(client)
        response = create_characteristic(client)
        assert response.status_code == 201
        body = response.json()
        assert body["code"] == "A1"
        assert body["nominal"] == 10.0
        assert body["tol_plus"] == 0.1
        assert body["tol_type"] == "SYMMETRIC"

    def test_limits_characteristic_accepts_unilateral(self, db, client):
        admin_client(client, db)
        create_part_type(client)
        response = create_characteristic(
            client, tol_type="LIMITS", nominal=None, tol_plus=None,
            min_limit=9.9, max_limit=10.1)
        assert response.status_code == 201
        assert create_characteristic(
            client, code="A2", tol_type="LIMITS", nominal=None, tol_plus=None,
            max_limit=25.0).status_code == 201

    def test_symmetric_without_required_values_is_rejected(self, db, client):
        admin_client(client, db)
        create_part_type(client)
        assert create_characteristic(client, tol_plus=None).status_code == 422
        assert create_characteristic(client, nominal=None).status_code == 422

    def test_limits_without_any_limit_is_rejected(self, db, client):
        admin_client(client, db)
        create_part_type(client)
        payload = {"code": "A1", "tol_type": "LIMITS", "min_limit": None, "max_limit": None}
        assert create_characteristic(client, nominal=None, tol_plus=None,
                                     **payload).status_code == 422

    def test_limits_with_min_above_max_is_rejected(self, db, client):
        admin_client(client, db)
        create_part_type(client)
        assert create_characteristic(
            client, tol_type="LIMITS", nominal=None, tol_plus=None,
            min_limit=10.2, max_limit=9.9).status_code == 422

    def test_duplicate_code_within_part_type_returns_409(self, db, client):
        admin_client(client, db)
        create_part_type(client)
        create_characteristic(client)
        assert create_characteristic(client).status_code == 409

    def test_admin_edits_characteristic(self, db, client):
        admin_client(client, db)
        create_part_type(client)
        create_characteristic(client)
        response = client.patch("/api/characteristics/1", json={"nominal": 12.5})
        assert response.status_code == 200
        body = response.json()
        assert body["nominal"] == 12.5
        assert body["tol_plus"] == 0.1

    def test_edit_to_invalid_combination_is_rejected(self, db, client):
        admin_client(client, db)
        create_part_type(client)
        create_characteristic(client)
        assert client.patch("/api/characteristics/1", json={"tol_plus": None}).status_code == 422

    def test_admin_deletes_characteristic(self, db, client):
        admin_client(client, db)
        create_part_type(client)
        create_characteristic(client)
        assert client.delete("/api/characteristics/1").status_code == 204
        listing = client.get("/api/part-types/1/characteristics")
        assert listing.json() == []
        assert client.delete("/api/characteristics/1").status_code == 404

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
