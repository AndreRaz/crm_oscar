"""Pydantic v2 I/O schemas."""
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


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
    code: str = Field(min_length=1, max_length=40)


class PartTypePatchIn(BaseModel):
    active: bool | None = None


class PartTypeOut(BaseModel):
    id: int
    code: str
    image_path: str | None
    active: bool


class _CharacteristicFields(BaseModel):
    code: str = Field(min_length=1, max_length=40)
    name: str | None = Field(default=None, max_length=120)
    unit: str | None = Field(default=None, max_length=20)
    tol_type: str = Field(pattern="^(SYMMETRIC|LIMITS)$")
    nominal: float | None = None
    tol_plus: float | None = None
    min_limit: float | None = None
    max_limit: float | None = None
    sort_order: int = 0


class CharacteristicIn(_CharacteristicFields):
    pass


class CharacteristicPatchIn(_CharacteristicFields):
    code: str | None = Field(default=None, min_length=1, max_length=40)
    tol_type: str | None = Field(default=None, pattern="^(SYMMETRIC|LIMITS)$")


class CharacteristicOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    part_type_id: int
    code: str
    name: str | None
    unit: str | None
    tol_type: str
    nominal: float | None
    tol_plus: float | None
    min_limit: float | None
    max_limit: float | None
    sort_order: int


class BalloonIn(BaseModel):
    number: int = Field(ge=1)
    characteristic_id: int
    x: float = Field(ge=0, le=1)
    y: float = Field(ge=0, le=1)


class BalloonOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    part_type_id: int
    number: int
    characteristic_id: int
    x: float
    y: float


class InspectionStartIn(BaseModel):
    part_type_id: int
    serial: str = Field(min_length=1, max_length=80)
    characteristic_ids: list[int] = Field(min_length=1)


class MeasurementIn(BaseModel):
    characteristic_id: int
    actual_value: float


class MeasurementOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    characteristic_id: int
    actual_value: float
    nominal_snapshot: float | None
    lower_limit_snapshot: float | None
    upper_limit_snapshot: float | None
    deviation: float | None
    status: str
    disposition_by: int | None = None
    disposition_at: datetime | None = None
    disposition_note: str | None = None


class InspectionOut(BaseModel):
    id: int
    part_type_id: int
    serial: str
    inspector: str
    status: str
    started_at: datetime
    completed_at: datetime | None
    characteristic_ids: list[int]
    measurements: list[MeasurementOut] = []


class QueueInspectionOut(BaseModel):
    id: int
    part_type_code: str
    serial: str
    inspector: str
    completed_at: datetime
    status: str


class DeviationGroupOut(BaseModel):
    inspection: QueueInspectionOut
    measurements: list[MeasurementOut]


class DeviationsOut(BaseModel):
    groups: list[DeviationGroupOut]


class DispositionIn(BaseModel):
    action: str = Field(pattern="^(accept|reject)$")
    text: str = Field(max_length=500)
