from sqlalchemy import select

from app.models import User
from tests.conftest import login, make_user


def auth_client(client, db, role="admin"):
    make_user(db, "admin", role="admin")
    login(client, "admin")
    return client


class TestCreateUser:
    def test_admin_creates_user_who_can_login(self, db, client):
        auth_client(client, db)
        response = client.post("/api/users", json={
            "username": "nina", "password": "longpass1", "role": "inspector"})
        assert response.status_code == 201
        assert response.json() == {"id": 2, "username": "nina", "role": "inspector", "active": True}
        assert login(client, "nina", "longpass1").status_code == 200

    def test_duplicate_username_returns_409(self, db, client):
        auth_client(client, db)
        response = client.post("/api/users", json={
            "username": "admin", "password": "longpass1", "role": "inspector"})
        assert response.status_code == 409


class TestDeactivate:
    def test_deactivate_invalidates_existing_session(self, db, client):
        auth_client(client, db)
        bob = make_user(db, "bob", "inspector")
        login(client, "bob")
        bob_cookie = client.cookies.get("session")
        client.post("/api/auth/logout")
        login(client, "admin")
        assert client.patch(f"/api/users/{bob.id}", json={"active": False}).status_code == 200
        client.cookies.set("session", bob_cookie)
        assert client.get("/api/auth/me").status_code == 401

    def test_deactivated_user_cannot_login(self, db, client):
        auth_client(client, db)
        make_user(db, "bob", "inspector", active=False)
        assert login(client, "bob").status_code == 401


class TestResetPassword:
    def test_reset_replaces_old_password(self, db, client):
        auth_client(client, db)
        make_user(db, "bob", "inspector")
        response = client.patch("/api/users/2", json={"password": "newlongpass"})
        assert response.status_code == 200
        assert login(client, "bob", "secret123").status_code == 401
        assert login(client, "bob", "newlongpass").status_code == 200


class TestRoleGuard:
    def test_inspector_gets_403_on_all_user_endpoints(self, db, client):
        make_user(db, "raul", "inspector")
        login(client, "raul")
        assert client.get("/api/users").status_code == 403
        assert client.post("/api/users", json={
            "username": "x", "password": "longpass1", "role": "inspector"}).status_code == 403
        assert client.patch("/api/users/1", json={"active": False}).status_code == 403

    def test_unauthenticated_gets_401(self, db, client):
        assert client.get("/api/users").status_code == 401
