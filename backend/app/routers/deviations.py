"""Shared deviation listing and admin-only resolution endpoints."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.deps import get_current_user, get_db, require_role
from app.models import Deviation, Measurement, User
from app.schemas import (
    DeviationOut, DeviationResolutionIn, DeviationsOut, DispositionIn,
    MeasurementOut,
)
from app.services import disposition as service

router = APIRouter(prefix="/api", tags=["deviations"])


@router.get("/deviations", response_model=DeviationsOut)
def queue(include_resolved: bool = False,
          db: Session = Depends(get_db),
          _: User = Depends(get_current_user)):
    return DeviationsOut(groups=service.pending_queue(
        db, include_resolved=include_resolved,
    ))


@router.post("/deviations/{deviation_id}/resolution", response_model=DeviationOut)
def resolve(deviation_id: int, payload: DeviationResolutionIn,
            db: Session = Depends(get_db),
            user: User = Depends(require_role("admin"))):
    deviation = db.get(Deviation, deviation_id)
    if deviation is None:
        raise HTTPException(status_code=404, detail="Deviation not found")
    try:
        return service.resolve_deviation(
            db, deviation, payload.action, user,
            approved_deviation_id=payload.approved_deviation_id,
            rejection_reason=payload.rejection_reason,
        )
    except service.DispositionError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc


@router.post("/measurements/{measurement_id}/disposition",
             response_model=MeasurementOut)
def disposition(measurement_id: int, payload: DispositionIn,
                db: Session = Depends(get_db),
                user: User = Depends(require_role("admin"))):
    measurement = db.get(Measurement, measurement_id)
    if measurement is None:
        raise HTTPException(status_code=404, detail="Measurement not found")
    deviation = db.scalar(select(Deviation).where(
        Deviation.measurement_id == measurement_id,
        Deviation.origin == "AUTO",
    ))
    if deviation is None:
        raise HTTPException(status_code=409, detail="AUTO deviation not found")
    try:
        service.resolve_deviation(
            db, deviation, payload.action, user,
            approved_deviation_id=payload.approved_deviation_id,
            rejection_reason=payload.rejection_reason,
        )
        return measurement
    except service.DispositionError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc
