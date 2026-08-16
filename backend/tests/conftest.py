import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.models import Base, User
from app.services.auth import hash_password


def make_user(db, username, role="inspector", active=True, password="secret123"):
    user = User(username=username, role=role, active=active,
                password_hash=hash_password(password))
    db.add(user)
    db.commit()
    return user


@pytest.fixture()
def db():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False},
                           poolclass=StaticPool)
    Base.metadata.create_all(engine)
    session = sessionmaker(bind=engine, expire_on_commit=False)()
    yield session
    session.close()
    engine.dispose()


@pytest.fixture()
def client(db, monkeypatch):
    from app.deps import get_db
    from app.main import app

    monkeypatch.setenv("DATABASE_URL", "sqlite://")
    app.dependency_overrides[get_db] = lambda: db
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()


def login(client, username="alice", password="secret123"):
    return client.post("/api/auth/login", json={"username": username, "password": password})
