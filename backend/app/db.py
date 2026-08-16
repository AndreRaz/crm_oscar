"""Database engine/session wiring."""
import os

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.models import Base

DATABASE_URL = os.environ.get("DATABASE_URL", "sqlite:///data/app.db")

engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {},
)
SessionLocal = sessionmaker(bind=engine, expire_on_commit=False)


def init_db() -> None:
    if DATABASE_URL.startswith("sqlite:///") and ":memory:" not in DATABASE_URL:
        path = DATABASE_URL.removeprefix("sqlite:///")
        if path:
            os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    Base.metadata.create_all(engine)
