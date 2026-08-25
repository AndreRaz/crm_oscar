"""Approved-deviation catalog API tests."""
import os

os.environ["DATABASE_URL"] = "sqlite://"

from sqlalchemy import select

from app.models import ApprovedDeviation
from tests.conftest import login, make_user


def seed_admin(db, client):
    make_user(db, "admin", role="admin")
    login(client, "admin")


def create_entry(client, code="AD-001", description="Use as-is"):
    return client.post(
        "/api/approved-deviations",
        json={"code": code, "description": description},
    )


class TestApprovedDeviationCatalog:
    def test_admin_creates_active_entry_and_lists_trimmed_values(self, db, client):
        seed_admin(db, client)

        response = create_entry(client, "  AD-001  ", "  Use as-is  ")

        assert response.status_code == 201
        body = response.json()
        assert {key: body[key] for key in ("id", "code", "description", "active")} == {
            "id": 1,
            "code": "AD-001",
            "description": "Use as-is",
            "active": True,
        }
        assert body["created_at"] is not None
        assert [row["code"] for row in client.get(
            "/api/approved-deviations",
        ).json()] == ["AD-001"]

    def test_admin_edits_deactivates_and_reactivates_without_deleting(self, db, client):
        seed_admin(db, client)
        assert create_entry(client).status_code == 201

        edited = client.patch(
            "/api/approved-deviations/1",
            json={"code": "AD-REVISED", "description": "Conditional release"},
        )
        deactivated = client.patch(
            "/api/approved-deviations/1", json={"active": False},
        )
        reactivated = client.patch(
            "/api/approved-deviations/1", json={"active": True},
        )

        assert edited.status_code == 200
        assert edited.json()["code"] == "AD-REVISED"
        assert edited.json()["description"] == "Conditional release"
        assert deactivated.json()["active"] is False
        assert reactivated.json()["active"] is True
        assert client.delete("/api/approved-deviations/1").status_code == 405
        assert db.scalar(select(ApprovedDeviation)).id == 1

    def test_inactive_entries_are_excluded_from_selectable_list(self, db, client):
        seed_admin(db, client)
        create_entry(client, "AD-ACTIVE", "Active option")
        create_entry(client, "AD-INACTIVE", "Inactive option")
        client.patch("/api/approved-deviations/2", json={"active": False})

        response = client.get("/api/approved-deviations?active_only=true")

        assert response.status_code == 200
        assert [(row["code"], row["active"]) for row in response.json()] == [
            ("AD-ACTIVE", True),
        ]

    def test_duplicate_code_blank_fields_and_unknown_patch_are_rejected(self, db, client):
        seed_admin(db, client)
        assert create_entry(client).status_code == 201

        duplicate = create_entry(client, description="Different meaning")
        blank = create_entry(client, "   ", "Missing code")
        explicit_inactive = client.post(
            "/api/approved-deviations",
            json={
                "code": "AD-INACTIVE", "description": "Invalid create",
                "active": False,
            },
        )
        missing = client.patch("/api/approved-deviations/99", json={"active": False})

        assert duplicate.status_code == 409
        assert blank.status_code == 422
        assert explicit_inactive.status_code == 422
        assert missing.status_code == 404
        assert db.query(ApprovedDeviation).count() == 1

    def test_inspector_can_list_but_cannot_manage_catalog(self, db, client):
        seed_admin(db, client)
        create_entry(client)
        client.post("/api/auth/logout")
        make_user(db, "inspector", role="inspector")
        login(client, "inspector")

        assert client.get(
            "/api/approved-deviations?active_only=true",
        ).status_code == 200
        assert create_entry(client, "AD-002", "Second option").status_code == 403
        assert client.patch(
            "/api/approved-deviations/1", json={"active": False},
        ).status_code == 403
