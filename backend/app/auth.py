import hashlib
import os
import secrets
import uuid
from datetime import datetime, timedelta, timezone

import jwt
from dotenv import load_dotenv
from google.auth.transport import requests as g_requests
from google.oauth2 import id_token as google_id_token
from pwdlib import PasswordHash
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models import RefreshToken, User

load_dotenv()
JWT_SECRET = os.environ["JWT_SECRET_KEY"]
GOOGLE_CLIENT_ID = os.environ["GOOGLE_CLIENT_ID"]
ACCESS_MINUTES = int(os.getenv("JWT_ACCESS_MINUTES", "15"))
REFRESH_DAYS = int(os.getenv("JWT_REFRESH_DAYS", "14"))
MIN_PASSWORD_LENGTH = 8

_hasher = PasswordHash.recommended()          # Argon2
_DUMMY_HASH = _hasher.hash("timing-equalizer")


class AuthError(Exception):
    def __init__(self, code: str, message: str, field: str | None = None):
        super().__init__(message)
        self.code, self.message, self.field = code, message, field


def _now() -> datetime:
    return datetime.now(timezone.utc)


# ---------- passwords ----------
def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    return _hasher.verify(password, password_hash)


# ---------- access tokens ----------
def create_access_token(user_id: int) -> str:
    now = _now()
    payload = {"sub": str(user_id), "type": "access", "iat": now,
               "exp": now + timedelta(minutes=ACCESS_MINUTES)}
    return jwt.encode(payload, JWT_SECRET, algorithm="HS256")


def decode_access_token(token: str) -> int:
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=["HS256"])
    except jwt.PyJWTError:
        raise AuthError("UNAUTHENTICATED", "Invalid or expired token")
    if payload.get("type") != "access":
        raise AuthError("UNAUTHENTICATED", "Invalid token type")
    return int(payload["sub"])


# ---------- refresh tokens (stored hashed, rotated on every use) ----------
def _hash_token(raw: str) -> str:
    return hashlib.sha256(raw.encode()).hexdigest()


def issue_refresh_token(db: Session, user_id: int, family_id: uuid.UUID | None = None) -> str:
    raw = secrets.token_urlsafe(48)
    db.add(RefreshToken(
        user_id=user_id,
        family_id=family_id or uuid.uuid4(),
        token_hash=_hash_token(raw),
        expires_at=_now() + timedelta(days=REFRESH_DAYS),
    ))
    return raw


def revoke_family(db: Session, family_id: uuid.UUID) -> None:
    db.execute(update(RefreshToken)
               .where(RefreshToken.family_id == family_id, RefreshToken.revoked_at.is_(None))
               .values(revoked_at=_now()))


def rotate_refresh_token(db: Session, raw: str) -> tuple[User, str]:
    row = db.scalar(select(RefreshToken)
                    .where(RefreshToken.token_hash == _hash_token(raw))
                    .with_for_update())
    if row is None:
        raise AuthError("UNAUTHENTICATED", "Invalid refresh token")
    if row.revoked_at is not None:                 # reuse of a rotated token
        revoke_family(db, row.family_id)
        db.commit()                                # persist the revocation, then fail
        raise AuthError("UNAUTHENTICATED", "Refresh token reuse detected")
    if row.expires_at <= _now():
        raise AuthError("UNAUTHENTICATED", "Refresh token expired")
    user = db.get(User, row.user_id)
    if user is None or not user.is_active:
        raise AuthError("UNAUTHENTICATED", "Account unavailable")
    row.revoked_at = _now()
    new_raw = issue_refresh_token(db, user.id, row.family_id)
    db.commit()
    return user, new_raw


def logout_refresh_token(db: Session, raw: str | None) -> None:
    if not raw:
        return
    row = db.scalar(select(RefreshToken).where(RefreshToken.token_hash == _hash_token(raw)))
    if row:
        revoke_family(db, row.family_id)
        db.commit()


# ---------- register / login ----------
def register_user(db: Session, email: str, password: str, display_name: str) -> User:
    email = email.strip().lower()
    name = display_name.strip()
    if "@" not in email or len(email) > 255:
        raise AuthError("INVALID_EMAIL", "Enter a valid email address", "email")
    if len(password) < MIN_PASSWORD_LENGTH:
        raise AuthError("PASSWORD_TOO_SHORT",
                        f"Password must be at least {MIN_PASSWORD_LENGTH} characters", "password")
    if not name:
        raise AuthError("REQUIRED", "Display name is required", "displayName")
    if db.scalar(select(User.id).where(User.email == email)):
        raise AuthError("EMAIL_TAKEN", "An account with this email already exists", "email")
    user = User(email=email, password_hash=hash_password(password), display_name=name)
    db.add(user)
    try:
        db.commit()
    except IntegrityError:                         # lost a race with another register
        db.rollback()
        raise AuthError("EMAIL_TAKEN", "An account with this email already exists", "email")
    return user


def authenticate(db: Session, email: str, password: str) -> User:
    user = db.scalar(select(User).where(User.email == email.strip().lower()))
    # Google-only accounts have no password_hash: verify against the dummy hash
    # so timing stays equal, then fail with the same generic error.
    hash_to_check = user.password_hash if user and user.password_hash else _DUMMY_HASH
    ok = verify_password(password, hash_to_check)
    if not user or not user.password_hash or not ok or not user.is_active:
        raise AuthError("INVALID_CREDENTIALS", "Incorrect email or password")
    return user


# Google sign-in
def _verify_google_token(token: str) -> dict:
    try:
        info = google_id_token.verify_oauth2_token(
            token, g_requests.Request(), GOOGLE_CLIENT_ID
        )
    except ValueError:
        raise AuthError("GOOGLE_AUTH_FAILED", "Invalid Google token. Please try again.")
    if info.get("iss") not in ("accounts.google.com", "https://accounts.google.com"):
        raise AuthError("GOOGLE_AUTH_FAILED", "Invalid Google token. Please try again.")
    if not info.get("email_verified"):
        raise AuthError("GOOGLE_EMAIL_UNVERIFIED", "Your Google email is not verified")
    return info


def authenticate_google(db: Session, token: str) -> User:
    """Verify a Google ID token, then find, link or create the matching user."""
    info = _verify_google_token(token)
    sub = info["sub"]
    email = info["email"].strip().lower()
    name = (info.get("name") or email.split("@")[0]).strip()

    user = db.scalar(select(User).where(User.google_sub == sub))
    if user is None:
        user = db.scalar(select(User).where(User.email == email))
        if user is not None:
            user.google_sub = sub                  # link: Google verified this email
        else:
            user = User(email=email, display_name=name,
                        google_sub=sub, password_hash=None)
            db.add(user)
        try:
            db.commit()
        except IntegrityError:                     # lost a race with another request
            db.rollback()
            user = db.scalar(select(User).where(User.email == email))
            if user is None:
                raise AuthError("GOOGLE_AUTH_FAILED", "Could not sign in with Google")
    if not user.is_active:
        raise AuthError("INVALID_CREDENTIALS", "Account unavailable")
    return user