import secrets

from fastapi import APIRouter, Depends, HTTPException
from google.auth.transport import requests as google_requests
from google.oauth2 import id_token
from pydantic import BaseModel, EmailStr, Field, field_validator
from sqlalchemy.orm import Session

from config import settings
from db import crud, models
from db.database import get_db
from logger import get_logger
from security import (
    DUMMY_HASH, create_access_token, get_current_user, hash_password, limit_auth, verify_password,
)

logger = get_logger(__name__)
router = APIRouter()


class RegisterRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=72)

    @field_validator("password")
    @classmethod
    def password_not_too_long_in_bytes(cls, v: str) -> str:
        # bcrypt only reads the first 72 BYTES (emoji/accents use more than 1 byte)
        if len(v.encode("utf-8")) > 72:
            raise ValueError("Password is too long (max 72 bytes)")
        return v


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=128)


def _auth_response(user: models.User) -> dict:
    return {
        "access_token": create_access_token(user.id),
        "token_type": "bearer",
        "user": {"id": user.id, "email": user.email},
    }


@router.post("/register", status_code=201, dependencies=[Depends(limit_auth)])
def register(body: RegisterRequest, db: Session = Depends(get_db)):
    if not settings.allow_registration:
        raise HTTPException(403, "Sign-ups are currently closed.")
    email = body.email.lower()
    if crud.get_user_by_email(db, email):
        raise HTTPException(409, "An account with this email already exists.")
    user = crud.create_user(db, email, hash_password(body.password))
    logger.info("New user registered: %s", user.id)
    return _auth_response(user)


@router.post("/login", dependencies=[Depends(limit_auth)])
def login(body: LoginRequest, db: Session = Depends(get_db)):
    user = crud.get_user_by_email(db, body.email.lower())
    # Same message + same timing whether the email or the password was wrong
    password_ok = verify_password(body.password, user.password_hash if user else DUMMY_HASH)
    if not user or not password_ok:
        logger.warning("Failed login attempt")
        raise HTTPException(401, "Incorrect email or password.")
    return _auth_response(user)


@router.get("/me")
def me(user: models.User = Depends(get_current_user)):
    return {"id": user.id, "email": user.email}


@router.get("/config")
def auth_config():
    """What the login screen needs to know. The Google client ID is public by design
    (it is visible in every site that uses Google sign-in) - the SECRET is what must stay private,
    and we don't use one: we only verify tokens."""
    return {
        "google_client_id": settings.google_client_id or None,
        "allow_registration": settings.allow_registration,
    }


class GoogleLoginRequest(BaseModel):
    credential: str = Field(min_length=20, max_length=4096)  # the ID token from Google


@router.post("/google", dependencies=[Depends(limit_auth)])
def google_login(body: GoogleLoginRequest, db: Session = Depends(get_db)):
    """
    How "Continue with Google" works:
      1. The browser shows Google's own button; the person picks their account in Google's popup.
      2. Google gives the browser a signed ID token ("credential") that says who they are.
      3. We send it here. We verify Google's signature, that it was issued for OUR client id,
         and that it hasn't expired. We never see their Google password.
      4. We find or create the user with that email and return OUR normal login token.
    """
    if not settings.google_client_id:
        raise HTTPException(503, "Google sign-in isn't set up on this server.")

    try:
        info = id_token.verify_oauth2_token(body.credential, google_requests.Request(), settings.google_client_id)
    except ValueError:  # bad signature, wrong audience, expired, malformed...
        logger.warning("Google token rejected")
        raise HTTPException(401, "Google sign-in failed. Please try again.")
    except Exception:  # e.g. could not download Google's public keys
        logger.exception("Could not verify Google token")
        raise HTTPException(503, "Couldn't reach Google to confirm your sign-in. Please try again.")

    email = (info.get("email") or "").lower()
    if not email or not info.get("email_verified"):
        raise HTTPException(401, "Your Google account's email isn't verified.")

    user = crud.get_user_by_email(db, email)
    if user is None:
        if not settings.allow_registration:
            raise HTTPException(403, "Sign-ups are currently closed.")
        # Random password nobody knows: this account can only be entered through Google.
        user = crud.create_user(db, email, hash_password(secrets.token_urlsafe(32)), email_verified=True)
        logger.info("New user via Google: %s", user.id)
    elif not user.email_verified:
        # Someone may have registered this email with a password BEFORE its real owner showed up
        # (nothing proved they owned it). Google has now proven who owns it, so we throw away
        # that password: whoever set it can no longer get in.
        crud.mark_email_verified(db, user, new_password_hash=hash_password(secrets.token_urlsafe(32)))
        logger.warning("Existing account %s verified via Google; old password invalidated", user.id)

    return _auth_response(user)
