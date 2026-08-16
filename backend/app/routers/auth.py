"""Auth endpoints: login/logout/me with DB-backed HttpOnly cookie sessions."""
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from sqlalchemy.orm import Session

from app.deps import get_current_user, get_db
from app.models import User
from app.schemas import LoginIn, UserOut
from app.services.auth import SESSION_COOKIE, login as do_login, logout as do_logout

router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.post("/login", response_model=UserOut)
def login(payload: LoginIn, response: Response, db: Session = Depends(get_db)):
    session = do_login(db, payload.username, payload.password)
    if session is None:
        raise HTTPException(status_code=401, detail="Invalid credentials")
    response.set_cookie(SESSION_COOKIE, session.token, httponly=True, samesite="lax")
    return session.user


@router.post("/logout")
def logout(request: Request, response: Response, db: Session = Depends(get_db)):
    do_logout(db, request.cookies.get(SESSION_COOKIE))
    response.delete_cookie(SESSION_COOKIE)
    return {"ok": True}


@router.get("/me", response_model=UserOut)
def me(user: User = Depends(get_current_user)):
    return user
