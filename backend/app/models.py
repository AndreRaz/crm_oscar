"""SQLAlchemy data model (design: Data Model, ADR-4/7/8)."""
from datetime import datetime, timezone

from sqlalchemy import (
    Boolean, CheckConstraint, DateTime, Enum, Float, ForeignKey, Integer,
    String, UniqueConstraint,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship

from app.services.status import InspectionStatus, MeasurementStatus


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Base(DeclarativeBase):
    pass


Role = Enum("admin", "inspector", name="role")
TolType = Enum("SYMMETRIC", "LIMITS", name="tol_type")


class User(Base):
    __tablename__ = "users"
    id: Mapped[int] = mapped_column(primary_key=True)
    username: Mapped[str] = mapped_column(String(80), unique=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    role: Mapped[str] = mapped_column(Role)
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class AuthSession(Base):
    __tablename__ = "auth_sessions"
    token: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    user: Mapped[User] = relationship()


class PartType(Base):
    __tablename__ = "part_types"
    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(40), unique=True)
    image_path: Mapped[str | None] = mapped_column(String(255), default=None)
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class Characteristic(Base):
    __tablename__ = "characteristics"
    __table_args__ = (
        UniqueConstraint("part_type_id", "code"),
        CheckConstraint(
            "(tol_type = 'SYMMETRIC' AND nominal IS NOT NULL AND tol_plus IS NOT NULL) "
            "OR (tol_type = 'LIMITS' AND (min_limit IS NOT NULL OR max_limit IS NOT NULL) "
            "AND (min_limit IS NULL OR max_limit IS NULL OR min_limit <= max_limit))",
            name="ck_characteristic_tolerance",
        ),
    )
    id: Mapped[int] = mapped_column(primary_key=True)
    part_type_id: Mapped[int] = mapped_column(ForeignKey("part_types.id"), index=True)
    code: Mapped[str] = mapped_column(String(40))
    name: Mapped[str | None] = mapped_column(String(120), default=None)
    unit: Mapped[str | None] = mapped_column(String(20), default=None)
    tol_type: Mapped[str] = mapped_column(TolType)
    nominal: Mapped[float | None] = mapped_column(Float, default=None)
    tol_plus: Mapped[float | None] = mapped_column(Float, default=None)
    min_limit: Mapped[float | None] = mapped_column(Float, default=None)
    max_limit: Mapped[float | None] = mapped_column(Float, default=None)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)


class Balloon(Base):
    __tablename__ = "balloons"
    __table_args__ = (
        UniqueConstraint("part_type_id", "number"),
        CheckConstraint("x >= 0 AND x <= 1 AND y >= 0 AND y <= 1", name="ck_balloon_xy"),
    )
    id: Mapped[int] = mapped_column(primary_key=True)
    part_type_id: Mapped[int] = mapped_column(ForeignKey("part_types.id"), index=True)
    number: Mapped[int] = mapped_column(Integer)
    characteristic_id: Mapped[int] = mapped_column(ForeignKey("characteristics.id"), unique=True)
    x: Mapped[float] = mapped_column(Float)
    y: Mapped[float] = mapped_column(Float)


class Piece(Base):
    __tablename__ = "pieces"
    __table_args__ = (UniqueConstraint("part_type_id", "serial"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    part_type_id: Mapped[int] = mapped_column(ForeignKey("part_types.id"), index=True)
    serial: Mapped[str] = mapped_column(String(80))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class Inspection(Base):
    __tablename__ = "inspections"
    id: Mapped[int] = mapped_column(primary_key=True)
    piece_id: Mapped[int] = mapped_column(ForeignKey("pieces.id"), index=True)
    inspector_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    status: Mapped[InspectionStatus] = mapped_column(
        Enum(InspectionStatus, name="inspection_status"))
    started_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime, default=None)
    annulled_at: Mapped[datetime | None] = mapped_column(DateTime, default=None)
    annulled_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"), default=None)
    annulment_reason: Mapped[str | None] = mapped_column(String(500), default=None)


class Measurement(Base):
    __tablename__ = "measurements"
    __table_args__ = (
        UniqueConstraint("inspection_id", "characteristic_id"),
    )
    id: Mapped[int] = mapped_column(primary_key=True)
    inspection_id: Mapped[int] = mapped_column(ForeignKey("inspections.id"), index=True)
    characteristic_id: Mapped[int] = mapped_column(ForeignKey("characteristics.id"))
    actual_value: Mapped[float] = mapped_column(Float)
    nominal_snapshot: Mapped[float | None] = mapped_column(Float, default=None)
    lower_limit_snapshot: Mapped[float | None] = mapped_column(Float, default=None)
    upper_limit_snapshot: Mapped[float | None] = mapped_column(Float, default=None)
    deviation: Mapped[float | None] = mapped_column(Float, default=None)
    status: Mapped[MeasurementStatus] = mapped_column(
        Enum(MeasurementStatus, name="measurement_status"))
    disposition_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"), default=None)
    disposition_at: Mapped[datetime | None] = mapped_column(DateTime, default=None)
    disposition_note: Mapped[str | None] = mapped_column(String(500), default=None)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
