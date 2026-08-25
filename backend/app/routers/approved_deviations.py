"""Approved-deviation catalog endpoints."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.deps import get_current_user, get_db, require_role
from app.models import ApprovedDeviation, User
from app.schemas import (
    ApprovedDeviationIn, ApprovedDeviationOut, ApprovedDeviationPatchIn,
)
from app.services import deviation_catalog as service

router = APIRouter(prefix="/api/approved-deviations", tags=["approved-deviations"])


@router.get("", response_model=list[ApprovedDeviationOut])
def listing(active_only: bool = False, db: Session = Depends(get_db),
            _: User = Depends(get_current_user)):
    return service.list_entries(db, active_only)


@router.post("", response_model=ApprovedDeviationOut, status_code=201)
def create(payload: ApprovedDeviationIn, db: Session = Depends(get_db),
           _: User = Depends(require_role("admin"))):
    try:
        return service.create_entry(db, payload.code, payload.description)
    except service.DeviationCatalogError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc


@router.patch("/{entry_id}", response_model=ApprovedDeviationOut)
def patch(entry_id: int, payload: ApprovedDeviationPatchIn,
          db: Session = Depends(get_db),
          _: User = Depends(require_role("admin"))):
    entry = db.get(ApprovedDeviation, entry_id)
    if entry is None:
        raise HTTPException(status_code=404, detail="Approved deviation not found")
    try:
        return service.update_entry(
            db, entry, **payload.model_dump(exclude_unset=True),
        )
    except service.DeviationCatalogError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc
