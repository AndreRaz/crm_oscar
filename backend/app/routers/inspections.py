"""Inspection execution endpoints: start, detail, record, complete."""
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.deps import get_current_user, get_db, require_role
from app.models import Inspection, Measurement, Piece, User
from app.schemas import (
    AnnulmentIn, DeviationOut, InspectionOut, InspectionStartIn,
    ManualDeviationIn, MeasurementIn, MeasurementOut,
)
from app.services import disposition as disposition_service
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
        characteristic_ids = list(map(int, inspection.selected_characteristic_ids.split(",")))
    return InspectionOut(
        id=inspection.id, part_type_id=piece.part_type_id,
        part_revision_id=inspection.part_revision_id,
        inspector=db.get(User, inspection.inspector_id).username,
        status=inspection.status, started_at=inspection.started_at,
        completed_at=inspection.completed_at, annulled_at=inspection.annulled_at,
        annulled_by=inspection.annulled_by,
        annulment_reason=inspection.annulment_reason,
        characteristic_ids=characteristic_ids,
        measurements=rows)


def authorize(inspection: Inspection, user: User) -> None:
    if user.role != "admin" and inspection.inspector_id != user.id:
        raise HTTPException(status_code=403, detail="Inspection belongs to another inspector")


@router.get("", response_model=list[InspectionOut])
def listing(scope: Literal["shared"] | None = None,
            db: Session = Depends(get_db),
            user: User = Depends(get_current_user)):
    query = select(Inspection).order_by(Inspection.id.desc())
    if scope == "shared":
        query = query.where(Inspection.completed_at.is_not(None))
    elif user.role != "admin":
        query = query.where(Inspection.inspector_id == user.id)
    return [inspection_out(db, item) for item in db.scalars(query).all()]


@router.post("", response_model=InspectionOut, status_code=201)
def start(payload: InspectionStartIn, db: Session = Depends(get_db),
          user: User = Depends(get_current_user)):
    try:
        inspection = service.start_inspection(
            db, payload.part_type_id, payload.characteristic_ids, user)
    except service.InspectionError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc
    return inspection_out(db, inspection, list(payload.characteristic_ids))


@router.get("/{inspection_id}", response_model=InspectionOut)
def detail(inspection_id: int, db: Session = Depends(get_db),
           user: User = Depends(get_current_user)):
    inspection = get_inspection_or_404(db, inspection_id); authorize(inspection, user)
    return inspection_out(db, inspection)


@router.post("/{inspection_id}/measurements", response_model=MeasurementOut, status_code=201)
def add_measurement(inspection_id: int, payload: MeasurementIn,
                    db: Session = Depends(get_db),
                     user: User = Depends(get_current_user)):
    inspection = get_inspection_or_404(db, inspection_id)
    authorize(inspection, user)
    try:
        return service.record_measurement(db, inspection,
                                          payload.characteristic_id, payload.actual_value)
    except service.InspectionError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc


@router.post(
    "/{inspection_id}/measurements/{measurement_id}/deviations",
    response_model=DeviationOut,
    status_code=201,
)
def create_manual_deviation(
        inspection_id: int, measurement_id: int, payload: ManualDeviationIn,
        db: Session = Depends(get_db),
        user: User = Depends(require_role("inspector"))):
    try:
        return disposition_service.create_manual_deviation(
            db, inspection_id, measurement_id, payload.description, user,
        )
    except disposition_service.DispositionError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc


@router.post("/{inspection_id}/complete", response_model=InspectionOut)
def complete(inspection_id: int, db: Session = Depends(get_db),
              user: User = Depends(get_current_user)):
    inspection = get_inspection_or_404(db, inspection_id)
    authorize(inspection, user)
    try:
        service.complete_inspection(db, inspection)
    except service.InspectionError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc
    return inspection_out(db, inspection)


@router.post("/{inspection_id}/annul", response_model=InspectionOut)
def annul(inspection_id: int, payload: AnnulmentIn,
          db: Session = Depends(get_db),
          user: User = Depends(require_role("admin"))):
    inspection = get_inspection_or_404(db, inspection_id)
    try:
        disposition_service.annul_inspection(db, inspection, payload.reason, user)
    except disposition_service.DispositionError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc
    return inspection_out(db, inspection)
