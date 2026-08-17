"""Deviation queue and measurement disposition endpoints (admin only)."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.deps import get_db, require_role
from app.models import User
from app.schemas import DeviationsOut
from app.services import disposition as service

router = APIRouter(prefix="/api/deviations", tags=["deviations"])


@router.get("", response_model=DeviationsOut)
def queue(db: Session = Depends(get_db),
          _: User = Depends(require_role("admin"))):
    return DeviationsOut(groups=service.pending_queue(db))
