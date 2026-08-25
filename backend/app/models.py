"""SQLAlchemy data model (design: Data Model, ADR-4/7/8)."""
from datetime import datetime, timezone

from sqlalchemy import (
    Boolean, CheckConstraint, DateTime, Enum, Float, ForeignKey, Index, Integer,
    String, Text, UniqueConstraint, text,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship, synonym

from app.services.status import InspectionStatus, MeasurementStatus


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Base(DeclarativeBase):
    pass


Role = Enum("admin", "inspector", name="role")
TolType = Enum("SYMMETRIC", "LIMITS", name="tol_type")
DeviationOrigin = Enum(
    "AUTO", "MANUAL", name="deviation_origin", create_constraint=True,
    validate_strings=True,
)
DeviationStatus = Enum(
    "PENDING", "ACCEPTED", "REJECTED", name="deviation_status",
    create_constraint=True, validate_strings=True,
)

FINITE_SQL = "BETWEEN -1.7976931348623157e308 AND 1.7976931348623157e308"


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
    __table_args__ = (
        CheckConstraint(
            "length(trim(part_number)) > 0",
            name="ck_part_type_part_number_nonblank",
        ),
        CheckConstraint(
            "length(trim(part_description)) > 0",
            name="ck_part_type_part_description_nonblank",
        ),
        CheckConstraint("revision_no > 0", name="ck_part_type_revision_no_positive"),
    )
    id: Mapped[int] = mapped_column(primary_key=True)
    part_number: Mapped[str] = mapped_column(String(120), unique=True)
    part_description: Mapped[str] = mapped_column(String(500))
    legacy_code: Mapped[str | None] = mapped_column(String(40), default=None)
    revision_no: Mapped[int] = mapped_column(Integer, default=1)
    image_path: Mapped[str | None] = mapped_column(String(255), default=None)
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class Characteristic(Base):
    __tablename__ = "characteristics"
    __table_args__ = (
        UniqueConstraint("part_type_id", "control_plan"),
        CheckConstraint(
            "length(trim(control_plan)) > 0",
            name="ck_characteristic_control_plan_nonblank",
        ),
        CheckConstraint(
            "length(trim(measurement_method)) > 0",
            name="ck_characteristic_measurement_method_nonblank",
        ),
        CheckConstraint(
            f"nominal {FINITE_SQL} AND min_limit {FINITE_SQL} "
            f"AND max_limit {FINITE_SQL}",
            name="ck_characteristic_canonical_values_finite",
        ),
        CheckConstraint(
            "min_limit <= nominal AND nominal <= max_limit",
            name="ck_characteristic_canonical_range",
        ),
    )
    id: Mapped[int] = mapped_column(primary_key=True)
    part_type_id: Mapped[int] = mapped_column(ForeignKey("part_types.id"), index=True)
    control_plan: Mapped[str] = mapped_column(String(40))
    name: Mapped[str | None] = mapped_column(String(120), default=None)
    unit: Mapped[str | None] = mapped_column(String(20), default=None)
    measurement_method: Mapped[str] = mapped_column(String(500))
    tol_type: Mapped[str] = mapped_column(TolType)
    nominal: Mapped[float] = mapped_column(Float)
    tol_plus: Mapped[float | None] = mapped_column(Float, default=None)
    tol_minus: Mapped[float | None] = mapped_column(Float, default=None)
    min_limit: Mapped[float] = mapped_column(Float)
    max_limit: Mapped[float] = mapped_column(Float)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    active: Mapped[bool] = mapped_column(Boolean, default=True)


class Balloon(Base):
    __tablename__ = "balloons"
    __table_args__ = (
        CheckConstraint("x >= 0 AND x <= 1 AND y >= 0 AND y <= 1", name="ck_balloon_xy"),
    )
    id: Mapped[int] = mapped_column(primary_key=True)
    part_type_id: Mapped[int] = mapped_column(ForeignKey("part_types.id"), index=True)
    characteristic_id: Mapped[int] = mapped_column(ForeignKey("characteristics.id"), unique=True)
    x: Mapped[float] = mapped_column(Float)
    y: Mapped[float] = mapped_column(Float)


class Piece(Base):
    __tablename__ = "pieces"
    id: Mapped[int] = mapped_column(primary_key=True)
    part_type_id: Mapped[int] = mapped_column(ForeignKey("part_types.id"), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class PartRevision(Base):
    __tablename__ = "part_revisions"
    __table_args__ = (
        UniqueConstraint("part_type_id", "revision_no"),
        CheckConstraint(
            "revision_no > 0", name="ck_part_revision_revision_no_positive",
        ),
        CheckConstraint(
            "length(trim(definition_json)) > 0",
            name="ck_part_revision_definition_nonblank",
        ),
    )
    id: Mapped[int] = mapped_column(primary_key=True)
    part_type_id: Mapped[int] = mapped_column(
        ForeignKey("part_types.id", ondelete="RESTRICT"), index=True,
    )
    revision_no: Mapped[int] = mapped_column(Integer)
    definition_json: Mapped[str] = mapped_column(Text)
    created_by: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"), default=None,
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class Inspection(Base):
    __tablename__ = "inspections"
    id: Mapped[int] = mapped_column(primary_key=True)
    piece_id: Mapped[int] = mapped_column(ForeignKey("pieces.id"), index=True)
    part_revision_id: Mapped[int] = mapped_column(
        ForeignKey("part_revisions.id", ondelete="RESTRICT"), index=True,
    )
    inspector_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    selected_characteristic_ids: Mapped[str] = mapped_column(String(1000))
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
        CheckConstraint(
            f"nominal_snapshot {FINITE_SQL} AND min_limit_snapshot {FINITE_SQL} "
            f"AND max_limit_snapshot {FINITE_SQL}",
            name="ck_measurement_snapshot_values_finite",
        ),
    )
    id: Mapped[int] = mapped_column(primary_key=True)
    inspection_id: Mapped[int] = mapped_column(ForeignKey("inspections.id"), index=True)
    characteristic_id: Mapped[int] = mapped_column(ForeignKey("characteristics.id"))
    actual_value: Mapped[float] = mapped_column(Float)
    nominal_snapshot: Mapped[float] = mapped_column(Float)
    min_limit_snapshot: Mapped[float] = mapped_column(Float)
    max_limit_snapshot: Mapped[float] = mapped_column(Float)
    measurement_method_snapshot: Mapped[str | None] = mapped_column(
        String(500), default=None,
    )
    lower_limit_snapshot = synonym("min_limit_snapshot")
    upper_limit_snapshot = synonym("max_limit_snapshot")
    deviation: Mapped[float | None] = mapped_column(Float, default=None)
    status: Mapped[MeasurementStatus] = mapped_column(
        Enum(MeasurementStatus, name="measurement_status"))
    disposition_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"), default=None)
    disposition_at: Mapped[datetime | None] = mapped_column(DateTime, default=None)
    disposition_note: Mapped[str | None] = mapped_column(String(500), default=None)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class Deviation(Base):
    __tablename__ = "deviations"
    __table_args__ = (
        CheckConstraint(
            "origin != 'MANUAL' OR "
            "(description IS NOT NULL AND length(trim(description)) > 0)",
            name="ck_deviation_manual_description",
        ),
        CheckConstraint(
            "status != 'PENDING' OR "
            "(approved_deviation_id IS NULL "
            "AND approved_deviation_code_snapshot IS NULL "
            "AND approved_deviation_description_snapshot IS NULL "
            "AND rejection_reason IS NULL AND resolved_by IS NULL AND resolved_at IS NULL)",
            name="ck_deviation_pending_unresolved",
        ),
        CheckConstraint(
            "status != 'ACCEPTED' OR "
            "(approved_deviation_id IS NOT NULL "
            "AND length(trim(approved_deviation_code_snapshot)) > 0 "
            "AND length(trim(approved_deviation_description_snapshot)) > 0 "
            "AND rejection_reason IS NULL "
            "AND resolved_by IS NOT NULL AND resolved_at IS NOT NULL)",
            name="ck_deviation_accepted_snapshot",
        ),
        CheckConstraint(
            "status != 'REJECTED' OR "
            "(approved_deviation_id IS NULL "
            "AND approved_deviation_code_snapshot IS NULL "
            "AND approved_deviation_description_snapshot IS NULL "
            "AND length(trim(rejection_reason)) > 0 "
            "AND resolved_by IS NOT NULL AND resolved_at IS NOT NULL)",
            name="ck_deviation_rejected_snapshot",
        ),
        Index(
            "uq_deviation_auto_measurement",
            "measurement_id",
            unique=True,
            sqlite_where=text("origin = 'AUTO'"),
        ),
        Index(
            "uq_deviation_pending_manual_measurement",
            "measurement_id",
            unique=True,
            sqlite_where=text("origin = 'MANUAL' AND status = 'PENDING'"),
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    measurement_id: Mapped[int] = mapped_column(
        ForeignKey("measurements.id"), index=True,
    )
    origin: Mapped[str] = mapped_column(DeviationOrigin)
    status: Mapped[str] = mapped_column(DeviationStatus, default="PENDING")
    description: Mapped[str | None] = mapped_column(String(500), default=None)
    created_by: Mapped[int | None] = mapped_column(
        ForeignKey("users.id"), default=None,
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    approved_deviation_id: Mapped[int | None] = mapped_column(
        ForeignKey("approved_deviations.id", ondelete="RESTRICT"), default=None,
    )
    approved_deviation_code_snapshot: Mapped[str | None] = mapped_column(
        String(80), default=None,
    )
    approved_deviation_description_snapshot: Mapped[str | None] = mapped_column(
        String(500), default=None,
    )
    rejection_reason: Mapped[str | None] = mapped_column(String(500), default=None)
    resolution_text = synonym("rejection_reason")
    resolved_by: Mapped[int | None] = mapped_column(
        ForeignKey("users.id"), default=None,
    )
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime, default=None)


class ApprovedDeviation(Base):
    __tablename__ = "approved_deviations"
    __table_args__ = (
        CheckConstraint(
            "length(trim(code)) > 0", name="ck_approved_deviation_code_nonblank",
        ),
        CheckConstraint(
            "length(trim(description)) > 0",
            name="ck_approved_deviation_description_nonblank",
        ),
    )
    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(80), unique=True)
    description: Mapped[str] = mapped_column(String(500))
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class DeviationAuditEvent(Base):
    __tablename__ = "deviation_audit_events"
    __table_args__ = (
        CheckConstraint(
            "action IN ('ACCEPTED', 'REJECTED')",
            name="ck_deviation_audit_event_action",
        ),
    )
    id: Mapped[int] = mapped_column(primary_key=True)
    deviation_id: Mapped[int] = mapped_column(
        ForeignKey("deviations.id", ondelete="RESTRICT"), index=True,
    )
    action: Mapped[str] = mapped_column(String(20))
    actor_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"),
    )
    approved_deviation_id: Mapped[int | None] = mapped_column(
        ForeignKey("approved_deviations.id", ondelete="RESTRICT"), default=None,
    )
    approved_deviation_code_snapshot: Mapped[str | None] = mapped_column(
        String(80), default=None,
    )
    approved_deviation_description_snapshot: Mapped[str | None] = mapped_column(
        String(500), default=None,
    )
    rejection_reason: Mapped[str | None] = mapped_column(String(500), default=None)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class GeneratedReport(Base):
    __tablename__ = "generated_reports"
    __table_args__ = (
        CheckConstraint(
            "length(content_hash) = 64", name="ck_generated_report_hash_length",
        ),
        CheckConstraint(
            "length(trim(file_path)) > 0", name="ck_generated_report_path_nonblank",
        ),
    )
    id: Mapped[int] = mapped_column(primary_key=True)
    inspection_id: Mapped[int] = mapped_column(
        ForeignKey("inspections.id", ondelete="RESTRICT"), index=True,
    )
    part_revision_id: Mapped[int] = mapped_column(
        ForeignKey("part_revisions.id", ondelete="RESTRICT"),
    )
    content_hash: Mapped[str] = mapped_column(String(64))
    file_path: Mapped[str] = mapped_column(String(255), unique=True)
    generated_by: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"),
    )
    generated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
