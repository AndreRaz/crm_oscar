from app.services.auth import seed_admin

from tests.conftest import login, make_user


class TestLogin:
    def test_active_user_login_sets_httponly_cookie(self, db, client):
        make_user(db, "alice", "inspector")
        response = login(client)
        assert response.status_code == 200
        assert response.json() == {"id": 1, "username": "alice", "role": "inspector", "active": True}
        cookie = response.headers["set-cookie"].lower()
        assert "httponly" in cookie
        assert "samesite=lax" in cookie

    def test_me_returns_current_user_after_login(self, db, client):
        make_user(db, "alice", "inspector")
        login(client)
        response = client.get("/api/auth/me")
        assert response.status_code == 200
        assert response.json()["username"] == "alice"

    def test_wrong_password_rejected_without_session(self, db, client):
        make_user(db, "alice", "inspector")
        response = login(client, password="nope")
        assert response.status_code == 401
        assert "set-cookie" not in response.headers
        assert client.get("/api/auth/me").status_code == 401

    def test_unknown_user_rejected(self, db, client):
        assert login(client, "ghost").status_code == 401

    def test_inactive_user_rejected(self, db, client):
        make_user(db, "alice", "inspector", active=False)
        response = login(client)
        assert response.status_code == 401
        assert client.get("/api/auth/me").status_code == 401


class TestLogout:
    def test_logout_invalidates_session(self, db, client):
        make_user(db, "alice", "inspector")
        login(client)
        assert client.post("/api/auth/logout").status_code == 200
        assert client.get("/api/auth/me").status_code == 401


class TestAdminSeed:
    def test_env_admin_seed_creates_loginable_admin(self, db, client, monkeypatch):
        monkeypatch.setenv("ADMIN_USERNAME", "oscar")
        monkeypatch.setenv("ADMIN_PASSWORD", "admin-pass-1")
        seed_admin(db)
        response = login(client, "oscar", "admin-pass-1")
        assert response.status_code == 200
        assert response.json()["role"] == "admin"
