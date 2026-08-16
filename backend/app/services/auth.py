"""Auth service: Argon2id hashing, DB-backed sessions, env admin seed."""
import os
import secrets
from datetime import datetime, timedelta, timezone

from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import AuthSession, User

_password_hasher = PasswordHasher()
SESSION_TTL = timedelta(hours=8)
SESSION_COOKIE = "session"


def hash_password(password: str) -> str:
    return _password_hasher.hash(password)


def verify_password(password_hash: str, password: str) -> bool:
    try:
        return _password_hasher.verify(password_hash, password)
    except VerifyMismatchError:
        return False


def create_session(db: Session, user: User) -> AuthSession:
    session = AuthSession(
        token=secrets.token_urlsafe(32),
        user_id=user.id,
        expires_at=datetime.now(timezone.utc).replace(tzinfo=None) + SESSION_TTL,
    )
    db.add(session)
    db.commit()
    return session


def login(db: Session, username: str, password: str) -> AuthSession | None:
    user = db.scalar(select(User).where(User.username == username))
    if user is None or not user.active or not verify_password(user.password_hash, password):
        return None
    return create_session(db, user)


def logout(db: Session, token: str | None) -> None:
    if token:
        session = db.get(AuthSession, token)
        if session:
            db.delete(session)
            db.commit()


def get_user_by_token(db: Session, token: str | None) -> User | None:
    if not token:
        return None
    session = db.get(AuthSession, token)
    if session is None:
        return None
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    if session.expires_at < now:
        db.delete(session)
        db.commit()
        return None
    user = db.get(User, session.user_id)
    if user is None or not user.active:
        return None
    return user


def seed_admin(db: Session) -> None:
    username = os.environ.get("ADMIN_USERNAME")
    password = os.environ.get("ADMIN_PASSWORD")
    if not username or not password:
        return
    if db.scalar(select(User).where(User.username == username)):
        return
    db.add(User(username=username, role="admin", active=True,
                password_hash=hash_password(password)))
    db.commit()
