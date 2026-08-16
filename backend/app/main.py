"""FastAPI application wiring."""
from contextlib import asynccontextmanager

from fastapi import FastAPI
from sqlalchemy.orm import Session

from app.db import SessionLocal, init_db
from app.routers import auth, users
from app.services.auth import seed_admin


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    db: Session = SessionLocal()
    try:
        seed_admin(db)
    finally:
        db.close()
    yield


app = FastAPI(title="Dimensional Inspection API", lifespan=lifespan)
app.include_router(auth.router)
app.include_router(users.router)
