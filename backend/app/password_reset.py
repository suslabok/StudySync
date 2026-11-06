"""Forgot password: email a one-time link, then let the person choose a new password.

Flow
  1. requestPasswordReset(email)   always answers ok, whether or not the email has an account, so the form can't be
                                   used to find out who is registered. If there is an account, a link is emailed.
  2. passwordResetValid(token)     lets the page say "this link has expired" before asking for a password.
  3. resetPassword(token, newPassword)
                                   sets the password, uses up the link, and signs the person out everywhere
                                   (all refresh tokens revoked). Any other unused links for that account die too.

Safeguards: tokens are random (256 bits), stored only as a SHA-256 hash, last 1 hour, work once; at most 3 emails per
account per hour; the email is sent in the background so the response time doesn't reveal whether an account exists.

Email: set SMTP_HOST (and SMTP_USER / SMTP_PASSWORD / SMTP_FROM, SMTP_PORT=587) to send real mail. Gmail works with
an "app password" (free). Without SMTP_HOST the link is printed in the server console instead, for local development.
FRONTEND_URL (default http://localhost:5173) is where the link points.

Register in api.py: password_reset.type_defs, password_reset.query, password_reset.mutation.
Needs `from app import reset_models` in app/models.py (see reset_models.py).
"""
import hashlib
import logging
import os
import secrets
import smtplib
import threading
from datetime import datetime, timedelta, timezone
from email.message import EmailMessage
from urllib.parse import quote

from ariadne import MutationType, QueryType
from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.auth import MIN_PASSWORD_LENGTH, hash_password
from app.database import SessionLocal
from app.models import RefreshToken, User
from app.reset_models import PasswordResetToken

log = logging.getLogger("studysync.reset")

TOKEN_LIFETIME = timedelta(hours=1)
MAX_PER_HOUR = 3
MAX_PASSWORD = 128


def _hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def _now() -> datetime:
    return datetime.now(timezone.utc)


# =============================== email ===============================

def frontend_url() -> str:
    return os.environ.get("FRONTEND_URL", "http://localhost:5173").rstrip("/")


def reset_link(token: str) -> str:
    return f"{frontend_url()}/reset-password?token={quote(token)}"


def send_email(to: str, subject: str, body: str) -> None:
    """Send through SMTP, or print to the console when SMTP isn't configured. Never raises."""
    host = os.environ.get("SMTP_HOST", "").strip()
    if not host:
        log.warning("SMTP_HOST is not set, so no email was sent. Message for %s:\n%s\n%s", to, subject, body)
        print(f"\n[dev] Email to {to}: {subject}\n{body}\n", flush=True)
        return
    try:
        user = os.environ.get("SMTP_USER", "")
        msg = EmailMessage()
        msg["From"] = os.environ.get("SMTP_FROM") or user or "no-reply@studysync.local"
        msg["To"] = to
        msg["Subject"] = subject
        msg.set_content(body)
        with smtplib.SMTP(host, int(os.environ.get("SMTP_PORT", "587")), timeout=15) as s:
            s.starttls()
            if user:
                s.login(user, os.environ.get("SMTP_PASSWORD", ""))
            s.send_message(msg)
    except Exception:                                  # the person sees the same answer either way
        log.exception("Couldn't send the password reset email")


def _send_in_background(to: str, name: str, link: str) -> None:
    body = (f"Hi {name},\n\nSomeone asked to reset the password for your StudySync account.\n"
            f"Open this link to choose a new password (it works once and expires in 1 hour):\n\n{link}\n\n"
            "If that wasn't you, ignore this email. Your password won't change.\n")
    threading.Thread(target=send_email, args=(to, "Reset your StudySync password", body), daemon=True).start()


# =============================== service ===============================

class ResetError(Exception):
    def __init__(self, field: str | None, code: str, message: str):
        super().__init__(message)
        self.field, self.code, self.message = field, code, message


def request_reset(db: Session, email: str) -> None:
    """Make a link and email it, if the email belongs to an active account. Says nothing either way."""
    email = (email or "").strip().lower()
    if not email or len(email) > 255:
        return
    user = db.scalar(select(User).where(User.email == email))
    if user is None or not user.is_active:
        return
    recent = db.scalar(select(func.count()).select_from(PasswordResetToken)
                       .where(PasswordResetToken.user_id == user.id, PasswordResetToken.created_at > _now() - timedelta(hours=1)))
    if recent >= MAX_PER_HOUR:
        return
    token = secrets.token_urlsafe(32)
    # older unused links stop working: only the newest email's link is live
    db.execute(update(PasswordResetToken)
               .where(PasswordResetToken.user_id == user.id, PasswordResetToken.used_at.is_(None))
               .values(used_at=_now()))
    db.add(PasswordResetToken(user_id=user.id, token_hash=_hash(token), expires_at=_now() + TOKEN_LIFETIME))
    db.commit()
    _send_in_background(user.email, user.display_name or "there", reset_link(token))


def _live(db: Session, token: str) -> PasswordResetToken | None:
    if not token or len(token) > 200:
        return None
    row = db.scalar(select(PasswordResetToken).where(PasswordResetToken.token_hash == _hash(token)))
    if row is None or row.used_at is not None or row.expires_at <= _now():
        return None
    return row


def reset_password(db: Session, token: str, new_password: str) -> None:
    row = _live(db, token)
    if row is None:
        raise ResetError(None, "INVALID_TOKEN", "This link has expired or was already used. Ask for a new one.")
    if len(new_password or "") < MIN_PASSWORD_LENGTH:
        raise ResetError("newPassword", "TOO_SHORT", f"Use at least {MIN_PASSWORD_LENGTH} characters.")
    if len(new_password) > MAX_PASSWORD:
        raise ResetError("newPassword", "TOO_LONG", f"Use at most {MAX_PASSWORD} characters.")
    user = db.get(User, row.user_id)
    if user is None or not user.is_active:
        raise ResetError(None, "INVALID_TOKEN", "This link has expired or was already used. Ask for a new one.")
    try:
        user.password_hash = hash_password(new_password)
    except ValueError:
        raise ResetError("newPassword", "INVALID", "That password can't be used. Try a different one.")
    now = _now()
    db.execute(update(PasswordResetToken)
               .where(PasswordResetToken.user_id == user.id, PasswordResetToken.used_at.is_(None))
               .values(used_at=now))
    db.execute(update(RefreshToken)
               .where(RefreshToken.user_id == user.id, RefreshToken.revoked_at.is_(None))
               .values(revoked_at=now))
    db.commit()


# =============================== GraphQL ===============================

type_defs = """
type ResetRequestPayload { ok: Boolean!, errors: [UserError!]! }
type ResetPayload { ok: Boolean!, errors: [UserError!]! }

extend type Query { passwordResetValid(token: String!): Boolean! }

extend type Mutation {
  requestPasswordReset(email: String!): ResetRequestPayload!
  resetPassword(token: String!, newPassword: String!): ResetPayload!
}
"""

query = QueryType()
mutation = MutationType()


@query.field("passwordResetValid")
def resolve_valid(_, info, token):
    with SessionLocal() as db:
        return _live(db, token) is not None


@mutation.field("requestPasswordReset")
def resolve_request(_, info, email):
    with SessionLocal() as db:
        try:
            request_reset(db, email)
        except Exception:                      # same answer whatever happens inside
            db.rollback()
            log.exception("password reset request failed")
    return {"ok": True, "errors": []}


@mutation.field("resetPassword")
def resolve_reset(_, info, token, new_password):
    with SessionLocal() as db:
        try:
            reset_password(db, token, new_password)
        except ResetError as e:
            db.rollback()
            return {"ok": False, "errors": [{"field": e.field, "code": e.code, "message": e.message}]}
    return {"ok": True, "errors": []}