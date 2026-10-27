import base64
import binascii
import io
import os
import secrets
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from PIL import Image, ImageOps, UnidentifiedImageError
from sqlalchemy import update
from sqlalchemy.orm import Session

from app.auth import MIN_PASSWORD_LENGTH, AuthError, hash_password, verify_password
from app.models import RefreshToken, User

MAX_PASSWORD_LENGTH = 128

# ---------- avatar storage ----------
# backend/media/avatars/<file>.jpg  (served by main.py at /media/avatars/<file>.jpg)
MEDIA_DIR = Path(os.getenv("MEDIA_DIR", Path(__file__).resolve().parent.parent / "media"))
AVATAR_DIR = MEDIA_DIR / "avatars"
PUBLIC_API_URL = os.getenv("PUBLIC_API_URL", "http://localhost:8000").rstrip("/")

AVATAR_SIZE = 256
MAX_UPLOAD_CHARS = 1_500_000          # base64 text, roughly 1.1 MB of image
MAX_PIXELS = 25_000_000               # guards against decompression bombs
ALLOWED_FORMATS = {"JPEG", "PNG", "WEBP"}


def avatar_url(user: User) -> str | None:
    if not user.avatar_file:
        return None
    return f"{PUBLIC_API_URL}/media/avatars/{user.avatar_file}"


def update_profile(db: Session, user: User, display_name: str, tz: str) -> User:
    name = display_name.strip()
    if not name:
        raise AuthError("REQUIRED", "Display name is required", "displayName")
    if len(name) > 100:
        raise AuthError("TOO_LONG", "Display name must be 100 characters or fewer", "displayName")

    tz = tz.strip()
    try:
        ZoneInfo(tz)
    except (ZoneInfoNotFoundError, ValueError, OSError):
        raise AuthError("INVALID_TIMEZONE", "Choose a valid timezone", "timezone")

    user.display_name = name
    user.timezone = tz
    db.commit()
    return user


def change_password(db: Session, user: User, current_password: str | None, new_password: str) -> None:
    """Change (or, for Google-only accounts, set) the password.

    Does NOT commit: the caller issues a fresh refresh token and commits once,
    so every other signed-in session is logged out but this one stays alive.
    """
    if user.password_hash:
        if not current_password or not verify_password(current_password, user.password_hash):
            raise AuthError("INVALID_CREDENTIALS", "Current password is incorrect", "currentPassword")
        if current_password == new_password:
            raise AuthError("SAME_PASSWORD", "New password must be different from the current one", "newPassword")

    if len(new_password) < MIN_PASSWORD_LENGTH:
        raise AuthError("PASSWORD_TOO_SHORT",
                        f"Password must be at least {MIN_PASSWORD_LENGTH} characters", "newPassword")
    if len(new_password) > MAX_PASSWORD_LENGTH:
        raise AuthError("TOO_LONG",
                        f"Password must be {MAX_PASSWORD_LENGTH} characters or fewer", "newPassword")

    user.password_hash = hash_password(new_password)
    # sign out every existing session; the caller then issues a new one
    db.execute(update(RefreshToken)
               .where(RefreshToken.user_id == user.id, RefreshToken.revoked_at.is_(None))
               .values(revoked_at=datetime.now(timezone.utc)))


# ---------- avatar ----------
def _invalid() -> AuthError:
    return AuthError("INVALID_IMAGE", "That file is not a valid JPG, PNG or WebP image", "image")


def _square_avatar_bytes(data_url: str) -> bytes:
    """Never trust the browser: decode, validate, strip metadata, crop square, re-encode."""
    if len(data_url) > MAX_UPLOAD_CHARS:
        raise AuthError("TOO_LARGE", "That image is too large", "image")

    payload = data_url.split(",", 1)[-1]          # drop "data:image/jpeg;base64,"
    try:
        raw = base64.b64decode(payload, validate=True)
    except (binascii.Error, ValueError):
        raise _invalid()

    try:
        img = Image.open(io.BytesIO(raw))
        if img.format not in ALLOWED_FORMATS:
            raise _invalid()
        if img.width * img.height > MAX_PIXELS:
            raise AuthError("TOO_LARGE", "That image has too many pixels", "image")
        img.load()
        img = ImageOps.exif_transpose(img)
        if img.mode != "RGB":                       # flatten transparency onto white
            rgba = img.convert("RGBA")
            flat = Image.new("RGB", rgba.size, (255, 255, 255))
            flat.paste(rgba, mask=rgba.split()[3])
            img = flat
        img = ImageOps.fit(img, (AVATAR_SIZE, AVATAR_SIZE), Image.LANCZOS)   # centre crop
    except AuthError:
        raise
    except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError):
        raise _invalid()

    out = io.BytesIO()
    img.save(out, format="JPEG", quality=85, optimize=True)   # re-encoding drops EXIF/GPS
    return out.getvalue()


def _delete_file(name: str | None) -> None:
    if not name:
        return
    try:
        (AVATAR_DIR / name).unlink(missing_ok=True)
    except OSError:
        pass


def save_avatar(db: Session, user: User, data_url: str) -> User:
    jpeg = _square_avatar_bytes(data_url)
    AVATAR_DIR.mkdir(parents=True, exist_ok=True)

    new_name = f"{user.id}-{secrets.token_hex(8)}.jpg"   # new name each time: no stale browser cache
    (AVATAR_DIR / new_name).write_bytes(jpeg)

    old_name = user.avatar_file
    user.avatar_file = new_name
    try:
        db.commit()
    except Exception:
        db.rollback()
        _delete_file(new_name)
        raise
    _delete_file(old_name)
    return user


def remove_avatar(db: Session, user: User) -> User:
    old_name = user.avatar_file
    user.avatar_file = None
    db.commit()
    _delete_file(old_name)
    return user