"""Google Meet for courses.

Each course has at most one meeting link, shared by everyone in the course.
  * a private course: its owner sets it
  * a classroom: the teacher sets it, students see it
  * a study group: any member can set it
Nothing here talks to Google. People make a meeting at https://meet.new (or in Google Calendar), paste the link, and
we check it really is a meet.google.com address before saving, so the "Join meeting" button can't point anywhere else.

Register in api.py: meetings.type_defs, meetings.query, meetings.mutation.
Needs `from app import meeting_models` in app/models.py (see meeting_models.py).
"""
import re
from urllib.parse import urlparse

from ariadne import MutationType, QueryType
from graphql import GraphQLError
from sqlalchemy.orm import Session

from app import sharing
from app.database import SessionLocal
from app.meeting_models import CourseMeeting
from app.models import User
from app.schema import current_user

_CODE = re.compile(r"^/([a-z]{3}-[a-z]{4}-[a-z]{3})$")
_LOOKUP = re.compile(r"^/lookup/([A-Za-z0-9_-]{1,100})$")


class MeetingError(Exception):
    def __init__(self, field: str | None, code: str, message: str):
        super().__init__(message)
        self.field, self.code, self.message = field, code, message


def clean_url(raw: str | None) -> str | None:
    """A tidy https://meet.google.com/... link, None for an empty value, or MeetingError."""
    text = (raw or "").strip()
    if not text:
        return None
    bad = MeetingError("url", "INVALID", "That doesn't look like a Google Meet link. It should look like meet.google.com/abc-defg-hij.")
    if len(text) > 300 or re.search(r"\s", text):
        raise bad
    if re.fullmatch(r"[a-zA-Z]{3}-[a-zA-Z]{4}-[a-zA-Z]{3}", text):      # just the meeting code
        text = "meet.google.com/" + text
    try:
        p = urlparse(text if "://" in text else "https://" + text)
        port = p.port
    except ValueError:
        raise bad
    if p.scheme not in ("http", "https") or p.hostname != "meet.google.com" or p.username or p.password or port:
        raise bad
    path = p.path.rstrip("/")
    m = _CODE.match(path.lower())
    if m:
        return f"https://meet.google.com/{m.group(1)}"
    m = _LOOKUP.match(path)
    if m:
        return f"https://meet.google.com/lookup/{m.group(1)}"
    raise bad                                  # drops any ?authuser=... part, which can carry account details


def _find(db: Session, user: User, course_id):
    """(root course, can this person change the link)."""
    try:
        course = sharing._own_course(db, user, course_id)
    except sharing.ShareError:
        raise MeetingError(None, "NOT_FOUND", "Course not found.")
    root = sharing._root(db, course)
    can_edit = course.source_course_id is None or root.share_mode == "group"
    return root, can_edit


def get_meeting(db: Session, user: User, course_id) -> dict:
    root, can_edit = _find(db, user, course_id)
    row = db.get(CourseMeeting, root.id)
    return {"url": row.url if row else None, "can_edit": can_edit}


def set_meeting(db: Session, user: User, course_id, url: str | None) -> dict:
    root, can_edit = _find(db, user, course_id)
    if not can_edit:
        raise MeetingError(None, "FORBIDDEN", "Only the teacher can change the meeting link.")
    clean = clean_url(url)
    row = db.get(CourseMeeting, root.id)
    if clean is None:
        if row:
            db.delete(row)
    elif row:
        row.url = clean
    else:
        db.add(CourseMeeting(course_id=root.id, url=clean))
    db.commit()
    return {"url": clean, "can_edit": True}


type_defs = """
type CourseMeeting { url: String, canEdit: Boolean! }
type MeetingPayload { meeting: CourseMeeting, errors: [UserError!]! }

extend type Query { courseMeeting(courseId: ID!): CourseMeeting! }
extend type Mutation { setCourseMeeting(courseId: ID!, url: String): MeetingPayload! }
"""

query = QueryType()
mutation = MutationType()


@query.field("courseMeeting")
def resolve_meeting(_, info, course_id):
    with SessionLocal() as db:
        user = current_user(info, db)
        try:
            return get_meeting(db, user, course_id)
        except MeetingError as e:
            raise GraphQLError(e.message, extensions={"code": e.code})


@mutation.field("setCourseMeeting")
def resolve_set(_, info, course_id, url=None):
    with SessionLocal() as db:
        user = current_user(info, db)
        try:
            return {"meeting": set_meeting(db, user, course_id, url), "errors": []}
        except MeetingError as e:
            db.rollback()
            return {"meeting": None, "errors": [{"field": e.field, "code": e.code, "message": e.message}]}