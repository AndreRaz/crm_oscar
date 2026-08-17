"""Stability analysis endpoint."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.deps import get_db, require_role
from app.models import User
from app.services.stability import analysis

router = APIRouter(prefix="/api/stability", tags=["stability"])


@router.get("")
def get_analysis(part_type_id: int, characteristic_id: int,
                 db: Session = Depends(get_db),
                 _: User = Depends(require_role("admin"))):
    try:
        return analysis(db, part_type_id, characteristic_id)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
