"""Admin-only user management endpoints."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.deps import get_db, require_role
from app.models import User
from app.schemas import UserCreateIn, UserOut, UserPatchIn
from app.services.auth import hash_password

router = APIRouter(prefix="/api/users", tags=["users"])


@router.get("", response_model=list[UserOut])
def list_users(db: Session = Depends(get_db), _: User = Depends(require_role("admin"))):
    return db.scalars(select(User).order_by(User.id)).all()


@router.post("", response_model=UserOut, status_code=201)
def create_user(payload: UserCreateIn, db: Session = Depends(get_db),
                _: User = Depends(require_role("admin"))):
    if db.scalar(select(User).where(User.username == payload.username)):
        raise HTTPException(status_code=409, detail="Username already exists")
    user = User(username=payload.username, role=payload.role, active=True,
                password_hash=hash_password(payload.password))
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


@router.patch("/{user_id}", response_model=UserOut)
def patch_user(user_id: int, payload: UserPatchIn, db: Session = Depends(get_db),
               _: User = Depends(require_role("admin"))):
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    if payload.active is not None:
        user.active = payload.active
    if payload.password is not None:
        user.password_hash = hash_password(payload.password)
    db.commit()
    db.refresh(user)
    return user
