"""Deviation queue and measurement disposition endpoints (admin only)."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.deps import get_db, require_role
from app.models import Measurement, User
from app.schemas import DeviationsOut, DispositionIn, MeasurementOut
from app.services import disposition as service

router = APIRouter(prefix="/api", tags=["deviations"])


@router.get("/deviations", response_model=DeviationsOut)
def queue(db: Session = Depends(get_db),
          _: User = Depends(require_role("admin"))):
    return DeviationsOut(groups=service.pending_queue(db))


@router.post("/measurements/{measurement_id}/disposition",
             response_model=MeasurementOut)
def disposition(measurement_id: int, payload: DispositionIn,
                db: Session = Depends(get_db),
                user: User = Depends(require_role("admin"))):
    measurement = db.get(Measurement, measurement_id)
    if measurement is None:
        raise HTTPException(status_code=404, detail="Measurement not found")
    try:
        return service.dispose_measurement(db, measurement, payload.action,
                                           payload.text, user)
    except service.DispositionError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc
