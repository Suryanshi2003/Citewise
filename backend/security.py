"""
Everything about "who is this person and are they allowed in".

How login works (the simple version):
  1. User registers/logs in  -> server checks the password against a bcrypt HASH
     (we never store the real password).
  2. Server returns a JWT "token": a signed string that says "this is user X,
     valid until time T". Only our SECRET_KEY can sign it, so it can't be faked.
  3. The frontend sends that token in the header  Authorization: Bearer <token>
     on every request. get_current_user() checks the signature and loads the user.
"""
import threading
import time
from collections import defaultdict, deque
from datetime import datetime, timedelta, timezone

import bcrypt
import jwt
from fastapi import Depends, HTTPException, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from config import settings
from db import crud, models
from db.database import get_db

ALGORITHM = "HS256"
bearer_scheme = HTTPBearer(auto_error=False)


# ---------- Passwords ----------

def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode("utf-8"), password_hash.encode("utf-8"))
    except ValueError:
        return False


# A real hash we compare against when the email doesn't exist, so
# "unknown email" and "wrong password" take the same time to answer.
DUMMY_HASH = hash_password("not-a-real-password")


# ---------- Tokens ----------

def create_access_token(user_id: str) -> str:
    expires = datetime.now(timezone.utc) + timedelta(minutes=settings.access_token_expire_minutes)
    return jwt.encode({"sub": user_id, "exp": expires}, settings.secret_key, algorithm=ALGORITHM)


def get_current_user(
    creds: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> models.User:
    """Add `user = Depends(get_current_user)` to any route to make it login-only."""
    unauthorized = HTTPException(
        status_code=401, detail="Please log in again.", headers={"WWW-Authenticate": "Bearer"}
    )
    if creds is None:
        raise unauthorized
    try:
        payload = jwt.decode(creds.credentials, settings.secret_key, algorithms=[ALGORITHM])
    except jwt.PyJWTError:  # expired, tampered, or garbage token
        raise unauthorized
    user = crud.get_user(db, payload.get("sub", ""))
    if user is None:
        raise unauthorized
    return user


# ---------- Rate limiting (simple in-memory, per process) ----------

class RateLimiter:
    """Allows `per_minute` calls per key in any rolling 60 seconds."""

    def __init__(self, per_minute: int):
        self.per_minute = per_minute
        self._hits: dict[str, deque] = defaultdict(deque)
        self._lock = threading.Lock()

    def check(self, key: str) -> None:
        now = time.monotonic()
        with self._lock:
            hits = self._hits[key]
            while hits and now - hits[0] > 60:
                hits.popleft()
            if len(hits) >= self.per_minute:
                raise HTTPException(429, "Too many requests. Please wait a minute and try again.")
            hits.append(now)


_auth_limiter = RateLimiter(settings.auth_rate_limit_per_minute)
_chat_limiter = RateLimiter(settings.chat_rate_limit_per_minute)


def limit_auth(request: Request) -> None:
    """Stops password guessing: limited per IP address."""
    _auth_limiter.check(request.client.host if request.client else "unknown")


def limit_chat(user: models.User = Depends(get_current_user)) -> None:
    """Protects your Groq quota: limited per user."""
    _chat_limiter.check(user.id)
