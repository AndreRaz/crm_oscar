"""Pydantic v2 I/O schemas."""
from datetime import datetime
from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, FiniteFloat, StringConstraints


NonBlankText = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=1, max_length=500),
]
PartNumber = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=1, max_length=120),
]
ControlPlan = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=1, max_length=40),
]


class LoginIn(BaseModel):
    username: str
    password: str


class UserOut(BaseModel):
    id: int
    username: str
    role: str
    active: bool


class UserCreateIn(BaseModel):
    username: str = Field(min_length=1, max_length=80)
    password: str = Field(min_length=8)
    role: str = Field(pattern="^(admin|inspector)$")


class UserPatchIn(BaseModel):
    active: bool | None = None
    password: str | None = Field(default=None, min_length=8)


class PartTypeIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    part_number: PartNumber
    part_description: NonBlankText


class PartTypePatchIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    active: bool = Field(default=None)
    part_number: PartNumber = Field(default=None)
    part_description: NonBlankText = Field(default=None)


class PartTypeOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    part_number: str
    part_description: str
    image_path: str | None
    revision_no: int = Field(gt=0)
    active: bool


class _CharacteristicFields(BaseModel):
    model_config = ConfigDict(extra="forbid")

    control_plan: ControlPlan
    name: str | None = Field(default=None, max_length=120)
    unit: str | None = Field(default=None, max_length=20)
    measurement_method: NonBlankText
    tol_type: str = Field(pattern="^(SYMMETRIC|LIMITS)$")
    nominal: FiniteFloat
    tol_plus: FiniteFloat | None = None
    tol_minus: FiniteFloat | None = None
    min_limit: FiniteFloat | None = None
    max_limit: FiniteFloat | None = None
    sort_order: int = 0


class CharacteristicIn(_CharacteristicFields):
    pass


class CharacteristicPatchIn(_CharacteristicFields):
    control_plan: ControlPlan = Field(default=None)
    measurement_method: NonBlankText = Field(default=None)
    tol_type: str = Field(default=None, pattern="^(SYMMETRIC|LIMITS)$")
    nominal: FiniteFloat = Field(default=None)


class CharacteristicOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    part_type_id: int
    control_plan: str
    name: str | None
    unit: str | None
    measurement_method: str
    tol_type: str
    nominal: FiniteFloat
    tol_plus: FiniteFloat | None
    tol_minus: FiniteFloat | None
    min_limit: FiniteFloat
    max_limit: FiniteFloat
    sort_order: int


class BalloonIn(BaseModel):
    characteristic_id: int
    x: float = Field(ge=0, le=1)
    y: float = Field(ge=0, le=1)


class BalloonOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    part_type_id: int
    characteristic_id: int
    x: float
    y: float


class InspectionStartIn(BaseModel):
    part_type_id: int
    characteristic_ids: list[int] = Field(min_length=1)


class MeasurementIn(BaseModel):
    characteristic_id: int
    actual_value: float


class MeasurementOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    characteristic_id: int
    actual_value: float
    nominal_snapshot: FiniteFloat
    min_limit_snapshot: FiniteFloat
    max_limit_snapshot: FiniteFloat
    measurement_method_snapshot: str | None
    deviation: float | None
    status: str
    disposition_by: int | None = None
    disposition_at: datetime | None = None
    disposition_note: str | None = None


class InspectionOut(BaseModel):
    id: int
    part_type_id: int
    part_revision_id: int
    inspector: str
    status: str
    started_at: datetime
    completed_at: datetime | None
    annulled_at: datetime | None = None
    annulled_by: int | None = None
    annulment_reason: str | None = None
    characteristic_ids: list[int]
    measurements: list[MeasurementOut] = Field(default_factory=list)


class AnnulmentIn(BaseModel):
    reason: str = Field(max_length=500)


class QueueInspectionOut(BaseModel):
    id: int
    part_number: str
    inspector: str
    completed_at: datetime | None
    annulled_at: datetime | None = None
    status: str


class DeviationGroupOut(BaseModel):
    inspection: QueueInspectionOut
    deviations: list["DeviationOut"] = Field(default_factory=list)
    measurements: list[MeasurementOut] = Field(default_factory=list)


class DeviationsOut(BaseModel):
    groups: list[DeviationGroupOut]


class ManualDeviationIn(BaseModel):
    description: NonBlankText


class DeviationResolutionIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    action: str = Field(pattern="^(accept|reject)$")
    approved_deviation_id: int | None = Field(default=None, gt=0)
    rejection_reason: NonBlankText | None = None


class DeviationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    measurement_id: int
    origin: str
    status: str
    description: str | None
    created_by: int | None
    created_at: datetime
    approved_deviation_id: int | None
    approved_deviation_code_snapshot: str | None
    approved_deviation_description_snapshot: str | None
    rejection_reason: str | None
    resolved_by: int | None
    resolved_at: datetime | None


class DispositionIn(DeviationResolutionIn):
    """Backward-compatible contract for the legacy measurement endpoint."""


class PartRevisionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    part_type_id: int
    revision_no: int = Field(gt=0)
    definition_json: str
    created_by: int | None = None
    created_at: datetime


class ApprovedDeviationIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    code: NonBlankText
    description: NonBlankText


class ApprovedDeviationPatchIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    code: NonBlankText | None = None
    description: NonBlankText | None = None
    active: bool | None = None


class ApprovedDeviationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    code: str
    description: str
    active: bool
    created_at: datetime


class DeviationAuditEventOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    deviation_id: int
    action: str
    actor_id: int
    approved_deviation_id: int | None
    approved_deviation_code_snapshot: str | None
    approved_deviation_description_snapshot: str | None
    rejection_reason: str | None
    created_at: datetime


class GeneratedReportOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    inspection_id: int
    part_revision_id: int
    content_hash: str = Field(min_length=64, max_length=64)
    file_path: str
    generated_by: int
    generated_at: datetime


class ReportEligibilityOut(BaseModel):
    eligible: bool
    missing_items: list[str] = Field(default_factory=list)
