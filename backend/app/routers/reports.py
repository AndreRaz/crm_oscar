"""Ownership-scoped generated report listing, generation, and download."""
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.deps import get_current_user, get_db
from app.models import GeneratedReport, Inspection, User
from app.schemas import GeneratedReportOut
from app.services import report_management
from app.services.report import may_access_report

router = APIRouter(tags=["reports"])


def _inspection_or_404(db: Session, inspection_id: int) -> Inspection:
    inspection = db.get(Inspection, inspection_id)
    if inspection is None:
        raise HTTPException(status_code=404, detail="Inspection not found")
    return inspection


def _authorize(inspection: Inspection, user: User) -> None:
    if not may_access_report(user, inspection):
        raise HTTPException(status_code=403, detail="Forbidden")


@router.get("/api/reports", response_model=list[GeneratedReportOut])
def listing(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    query = select(GeneratedReport).join(
        Inspection, Inspection.id == GeneratedReport.inspection_id,
    ).order_by(GeneratedReport.id.desc())
    if user.role != "admin":
        query = query.where(Inspection.inspector_id == user.id)
    return db.scalars(query).all()


@router.post(
    "/api/inspections/{inspection_id}/reports",
    response_model=GeneratedReportOut,
    status_code=201,
)
def generate(inspection_id: int, request: Request,
             db: Session = Depends(get_db),
             user: User = Depends(get_current_user)):
    inspection = _inspection_or_404(db, inspection_id)
    _authorize(inspection, user)
    try:
        return report_management.generate_report(
            db, inspection, user.id, request.app.state.report_root,
        )
    except report_management.ReportIneligibleError as exc:
        raise HTTPException(status_code=409, detail=exc.missing_items) from exc


@router.get("/api/reports/{report_id}/download")
def download(report_id: int, request: Request,
             db: Session = Depends(get_db),
             user: User = Depends(get_current_user)):
    report = db.get(GeneratedReport, report_id)
    if report is None:
        raise HTTPException(status_code=404, detail="Generated report not found")
    _authorize(_inspection_or_404(db, report.inspection_id), user)
    try:
        content = request.app.state.report_root.read_report(report.file_path)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Generated report file not found") from exc
    return Response(
        content=content,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{report.file_path}"'},
    )
