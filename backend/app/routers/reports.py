"""Authorized, on-demand inspection report download."""
from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy.orm import Session

from app.deps import get_current_user, get_db
from app.models import Inspection, User
from app.services.report import may_download_report, render_report_pdf

router = APIRouter(prefix="/api/inspections", tags=["reports"])


@router.get("/{inspection_id}/report.pdf")
def download_report(inspection_id: int, db: Session = Depends(get_db),
                    user: User = Depends(get_current_user)):
    inspection = db.get(Inspection, inspection_id)
    if inspection is None:
        raise HTTPException(status_code=404, detail="Inspection not found")
    if not may_download_report(user, inspection):
        raise HTTPException(status_code=403, detail="Forbidden")
    pdf = render_report_pdf(db, inspection)
    return Response(
        content=pdf,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="inspection-{inspection.id}.pdf"'},
    )
