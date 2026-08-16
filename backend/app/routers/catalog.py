"""Catalog endpoints: part types, characteristics, balloons."""
from fastapi import APIRouter, Depends, HTTPException, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.deps import get_current_user, get_db, require_role
from app.models import PartType, User
from app.schemas import PartTypeIn, PartTypeOut, PartTypePatchIn
from app.services.catalog import images_dir, save_image

router = APIRouter(prefix="/api/part-types", tags=["catalog"])


@router.get("", response_model=list[PartTypeOut])
def list_part_types(db: Session = Depends(get_db),
                    _: User = Depends(get_current_user)):
    return db.scalars(select(PartType).order_by(PartType.id)).all()


@router.post("", response_model=PartTypeOut, status_code=201)
def create_part_type(payload: PartTypeIn, db: Session = Depends(get_db),
                     _: User = Depends(require_role("admin"))):
    if db.scalar(select(PartType).where(PartType.code == payload.code)):
        raise HTTPException(status_code=409, detail="Part type code already exists")
    part_type = PartType(code=payload.code)
    db.add(part_type)
    db.commit()
    db.refresh(part_type)
    return part_type


@router.get("/{part_type_id}", response_model=PartTypeOut)
def get_part_type(part_type_id: int, db: Session = Depends(get_db),
                  _: User = Depends(get_current_user)):
    part_type = db.get(PartType, part_type_id)
    if part_type is None:
        raise HTTPException(status_code=404, detail="Part type not found")
    return part_type


@router.patch("/{part_type_id}", response_model=PartTypeOut)
def patch_part_type(part_type_id: int, payload: PartTypePatchIn,
                    db: Session = Depends(get_db),
                    _: User = Depends(require_role("admin"))):
    part_type = db.get(PartType, part_type_id)
    if part_type is None:
        raise HTTPException(status_code=404, detail="Part type not found")
    if payload.active is not None:
        part_type.active = payload.active
    db.commit()
    db.refresh(part_type)
    return part_type


@router.post("/{part_type_id}/image", response_model=PartTypeOut)
def upload_image(part_type_id: int, file: UploadFile, db: Session = Depends(get_db),
                 _: User = Depends(require_role("admin"))):
    part_type = db.get(PartType, part_type_id)
    if part_type is None:
        raise HTTPException(status_code=404, detail="Part type not found")
    try:
        part_type.image_path = save_image(file.content_type, part_type_id, file.file.read())
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    db.commit()
    db.refresh(part_type)
    return part_type


@router.get("/{part_type_id}/image")
def get_image(part_type_id: int, db: Session = Depends(get_db),
              _: User = Depends(get_current_user)):
    part_type = db.get(PartType, part_type_id)
    if part_type is None or part_type.image_path is None:
        raise HTTPException(status_code=404, detail="Image not found")
    return FileResponse(images_dir() / part_type.image_path)
