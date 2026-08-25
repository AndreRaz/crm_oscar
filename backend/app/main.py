"""FastAPI application wiring."""
from contextlib import asynccontextmanager
from math import isfinite
import os
from typing import Any

from fastapi import FastAPI
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import SessionLocal, init_db
from app.models import GeneratedReport
from app.routers import (
    approved_deviations, auth, catalog, deviations, inspections, reports,
    revisions, stability, users,
)
from app.services.auth import seed_admin
from app.services.report_management import ReportRoot, reconcile_reports_root


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    report_root = ReportRoot.open(os.environ.get("REPORTS_DIR", "data/reports"))
    try:
        db: Session = SessionLocal()
        try:
            seed_admin(db)
            referenced_reports = set(db.scalars(select(GeneratedReport.file_path)))
        finally:
            db.close()
        reconcile_reports_root(report_root, referenced_reports)
        app.state.report_root = report_root
        yield
    finally:
        report_root.close()


app = FastAPI(title="Dimensional Inspection API", lifespan=lifespan)


def _json_safe(value: Any) -> Any:
    if isinstance(value, float) and not isfinite(value):
        return None
    if isinstance(value, dict):
        return {key: _json_safe(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_json_safe(item) for item in value]
    return value


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(_, exc: RequestValidationError):
    return JSONResponse(status_code=422, content={"detail": _json_safe(exc.errors())})


app.include_router(auth.router)
app.include_router(users.router)
app.include_router(catalog.router)
app.include_router(catalog.characteristics_router)
app.include_router(catalog.balloons_router)
app.include_router(revisions.router)
app.include_router(approved_deviations.router)
app.include_router(inspections.router)
app.include_router(deviations.router)
app.include_router(reports.router)
app.include_router(stability.router)
