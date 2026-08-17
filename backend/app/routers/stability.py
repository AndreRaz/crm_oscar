"""Stability analysis endpoint."""
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.deps import get_current_user, get_db
from app.models import User
from app.services.stability import analysis

router = APIRouter(prefix="/api/stability", tags=["stability"])


@router.get("")
def get_analysis(part_type_id: int, characteristic_id: int,
                 db: Session = Depends(get_db),
                 _: User = Depends(get_current_user)):
    return analysis(db, part_type_id, characteristic_id)
