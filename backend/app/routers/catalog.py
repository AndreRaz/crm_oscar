"""Catalog endpoints: part types, characteristics, balloons."""
from fastapi import APIRouter, Depends, HTTPException, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.deps import get_current_user, get_db, require_role
from app.models import Balloon, Characteristic, Measurement, PartType, User
from app.schemas import (
    BalloonIn, BalloonOut, CharacteristicIn, CharacteristicOut, CharacteristicPatchIn,
    PartTypeIn, PartTypeOut, PartTypePatchIn,
)
from app.services.catalog import images_dir, save_image, validate_characteristic

router = APIRouter(prefix="/api/part-types", tags=["catalog"])
characteristics_router = APIRouter(prefix="/api/characteristics", tags=["catalog"])
balloons_router = APIRouter(prefix="/api/balloons", tags=["catalog"])


@router.get("", response_model=list[PartTypeOut])
def list_part_types(db: Session = Depends(get_db),
                    _: User = Depends(get_current_user)):
    return db.scalars(select(PartType).order_by(PartType.id)).all()


@router.post("", response_model=PartTypeOut, status_code=201)
def create_part_type(payload: PartTypeIn, db: Session = Depends(get_db),
                     _: User = Depends(require_role("admin"))):
    if db.scalar(select(PartType).where(PartType.code == payload.code)):
        raise HTTPException(status_code=409, detail="Part type code already exists")
    part_type = PartType(**payload.model_dump())
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
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(part_type, field, value)
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


@router.get("/{part_type_id}/characteristics", response_model=list[CharacteristicOut])
def list_characteristics(part_type_id: int, db: Session = Depends(get_db),
                         _: User = Depends(get_current_user)):
    return db.scalars(select(Characteristic).where(Characteristic.part_type_id == part_type_id,
                                                    Characteristic.active.is_(True))
                      .order_by(Characteristic.sort_order, Characteristic.id)).all()


@router.post("/{part_type_id}/characteristics",
             response_model=CharacteristicOut, status_code=201)
def create_characteristic(part_type_id: int, payload: CharacteristicIn,
                          db: Session = Depends(get_db),
                          _: User = Depends(require_role("admin"))):
    if db.get(PartType, part_type_id) is None:
        raise HTTPException(status_code=404, detail="Part type not found")
    try:
        validate_characteristic(payload.tol_type, payload.nominal, payload.tol_plus,
                                payload.min_limit, payload.max_limit)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    if db.scalar(select(Characteristic).where(
            Characteristic.part_type_id == part_type_id,
            Characteristic.code == payload.code)):
        raise HTTPException(status_code=409, detail="Characteristic code already exists")
    characteristic = Characteristic(part_type_id=part_type_id, **payload.model_dump())
    db.add(characteristic)
    db.commit()
    db.refresh(characteristic)
    return characteristic


@characteristics_router.patch("/{characteristic_id}", response_model=CharacteristicOut)
def patch_characteristic(characteristic_id: int, payload: CharacteristicPatchIn,
                         db: Session = Depends(get_db),
                         _: User = Depends(require_role("admin"))):
    characteristic = db.get(Characteristic, characteristic_id)
    if characteristic is None:
        raise HTTPException(status_code=404, detail="Characteristic not found")
    updates = payload.model_dump(exclude_unset=True)
    try:
        validate_characteristic(
            updates.get("tol_type", characteristic.tol_type),
            updates.get("nominal", characteristic.nominal),
            updates.get("tol_plus", characteristic.tol_plus),
            updates.get("min_limit", characteristic.min_limit),
            updates.get("max_limit", characteristic.max_limit))
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    for field, value in updates.items():
        setattr(characteristic, field, value)
    db.commit()
    db.refresh(characteristic)
    return characteristic


@characteristics_router.delete("/{characteristic_id}", status_code=204)
def delete_characteristic(characteristic_id: int, db: Session = Depends(get_db),
                          _: User = Depends(require_role("admin"))):
    characteristic = db.get(Characteristic, characteristic_id)
    if characteristic is None:
        raise HTTPException(status_code=404, detail="Characteristic not found")
    if db.scalar(select(Measurement.id).where(Measurement.characteristic_id == characteristic_id)):
        characteristic.active = False
    else:
        db.delete(characteristic)
    db.commit()


@router.get("/{part_type_id}/balloons", response_model=list[BalloonOut])
def list_balloons(part_type_id: int, db: Session = Depends(get_db),
                  _: User = Depends(get_current_user)):
    return db.scalars(select(Balloon).join(Characteristic).where(Balloon.part_type_id == part_type_id,
                                                                 Characteristic.active.is_(True))
                      .order_by(Balloon.number)).all()


@router.post("/{part_type_id}/balloons", response_model=BalloonOut, status_code=201)
def create_balloon(part_type_id: int, payload: BalloonIn, db: Session = Depends(get_db),
                   _: User = Depends(require_role("admin"))):
    characteristic = db.get(Characteristic, payload.characteristic_id)
    if characteristic is None or not characteristic.active or characteristic.part_type_id != part_type_id:
        raise HTTPException(status_code=404, detail="Characteristic not found")
    if db.scalar(select(Balloon).where(Balloon.part_type_id == part_type_id,
                                       Balloon.number == payload.number)):
        raise HTTPException(status_code=409, detail="Balloon number already used")
    if db.scalar(select(Balloon).where(
            Balloon.characteristic_id == payload.characteristic_id)):
        raise HTTPException(status_code=409, detail="Characteristic already has a balloon")
    balloon = Balloon(part_type_id=part_type_id, **payload.model_dump())
    db.add(balloon)
    db.commit()
    db.refresh(balloon)
    return balloon


@balloons_router.delete("/{balloon_id}", status_code=204)
def delete_balloon(balloon_id: int, db: Session = Depends(get_db),
                   _: User = Depends(require_role("admin"))):
    balloon = db.get(Balloon, balloon_id)
    if balloon is None:
        raise HTTPException(status_code=404, detail="Balloon not found")
    db.delete(balloon)
    db.commit()
