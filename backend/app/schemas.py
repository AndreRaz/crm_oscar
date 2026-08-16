"""Pydantic v2 I/O schemas."""
from pydantic import BaseModel, Field


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
