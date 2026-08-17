"""Inspection execution endpoints: start, detail, record, complete."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.deps import get_current_user, get_db
from app.models import Inspection, Measurement, Piece, User
from app.schemas import InspectionOut, InspectionStartIn, MeasurementIn, MeasurementOut
from app.services import inspection as service

router = APIRouter(prefix="/api/inspections", tags=["inspections"])


def get_inspection_or_404(db: Session, inspection_id: int) -> Inspection:
    inspection = db.get(Inspection, inspection_id)
    if inspection is None:
        raise HTTPException(status_code=404, detail="Inspection not found")
    return inspection


def inspection_out(db: Session, inspection: Inspection,
                   characteristic_ids: list[int] | None = None) -> InspectionOut:
    piece = db.get(Piece, inspection.piece_id)
    rows = db.scalars(select(Measurement).where(
        Measurement.inspection_id == inspection.id).order_by(Measurement.id)).all()
    if characteristic_ids is None:
        characteristic_ids = sorted({m.characteristic_id for m in rows})
    return InspectionOut(
        id=inspection.id, part_type_id=piece.part_type_id, serial=piece.serial,
        inspector=db.get(User, inspection.inspector_id).username,
        status=inspection.status, started_at=inspection.started_at,
        completed_at=inspection.completed_at, characteristic_ids=characteristic_ids,
        measurements=rows)


@router.post("", response_model=InspectionOut, status_code=201)
def start(payload: InspectionStartIn, db: Session = Depends(get_db),
          user: User = Depends(get_current_user)):
    try:
        inspection = service.start_inspection(
            db, payload.part_type_id, payload.serial,
            payload.characteristic_ids, user)
    except service.InspectionError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc
    return inspection_out(db, inspection, list(payload.characteristic_ids))


@router.get("/{inspection_id}", response_model=InspectionOut)
def detail(inspection_id: int, db: Session = Depends(get_db),
           _: User = Depends(get_current_user)):
    return inspection_out(db, get_inspection_or_404(db, inspection_id))


@router.post("/{inspection_id}/measurements", response_model=MeasurementOut, status_code=201)
def add_measurement(inspection_id: int, payload: MeasurementIn,
                    db: Session = Depends(get_db),
                    _: User = Depends(get_current_user)):
    inspection = get_inspection_or_404(db, inspection_id)
    try:
        return service.record_measurement(db, inspection,
                                          payload.characteristic_id, payload.actual_value)
    except service.InspectionError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc


@router.post("/{inspection_id}/complete", response_model=InspectionOut)
def complete(inspection_id: int, db: Session = Depends(get_db),
             _: User = Depends(get_current_user)):
    inspection = get_inspection_or_404(db, inspection_id)
    try:
        service.complete_inspection(db, inspection)
    except service.InspectionError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc
    return inspection_out(db, inspection)
