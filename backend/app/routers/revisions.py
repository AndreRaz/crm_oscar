"""Revision endpoints: immutable history listing and admin-only restore."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.deps import get_current_user, get_db, require_role
from app.models import PartRevision, PartType, User
from app.schemas import PartRevisionOut
from app.services.revision import RevisionNotFoundError, restore_revision

router = APIRouter(prefix="/api/part-types", tags=["revisions"])


@router.get("/{part_type_id}/revisions", response_model=list[PartRevisionOut])
def list_revisions(part_type_id: int, db: Session = Depends(get_db),
                   _: User = Depends(get_current_user)):
    if db.get(PartType, part_type_id) is None:
        raise HTTPException(status_code=404, detail="Part type not found")
    return db.scalars(select(PartRevision)
                      .where(PartRevision.part_type_id == part_type_id)
                      .order_by(PartRevision.revision_no)).all()


@router.post("/{part_type_id}/revisions/{revision_no}/restore",
             response_model=PartRevisionOut)
def restore(part_type_id: int, revision_no: int, db: Session = Depends(get_db),
            user: User = Depends(require_role("admin"))):
    try:
        revision = restore_revision(db, part_type_id, revision_no, user.id)
    except RevisionNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    db.commit()
    db.refresh(revision)
    return revision
