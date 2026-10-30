"""Focus timer: finished study sessions, optionally linked to a course and/or a task.

The timer itself runs in the browser; this module stores what it finished and reads it back.
Register in api.py: focus.type_defs, focus.query, focus.mutation.
"""
from datetime import datetime, timedelta, timezone

from ariadne import MutationType, QueryType
from graphql import GraphQLError
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import SessionLocal
from app.models import Course, FocusSession, Task, User
from app.schema import current_user

MAX_SECONDS = 12 * 3600
MAX_AGE = timedelta(days=2)        # a session is logged when it ends (or when the page reopens)
MAX_ROWS = 1000


class FocusError(Exception):
    def __init__(self, field: str | None, code: str, message: str):
        super().__init__(message)
        self.field, self.code, self.message = field, code, message


def _when(value: str, field: str) -> datetime:
    try:
        d = datetime.fromisoformat((value or "").replace("Z", "+00:00"))
    except ValueError:
        raise FocusError(field, "INVALID", "That time isn't valid.")
    return d if d.tzinfo else d.replace(tzinfo=timezone.utc)


def _view(db: Session, s: FocusSession) -> dict:
    course = db.get(Course, s.course_id) if s.course_id else None
    task = db.get(Task, s.task_id) if s.task_id else None
    return {"id": s.id, "started_at": s.started_at.isoformat(), "seconds": s.seconds,
            "planned_seconds": s.planned_seconds, "course": course, "task_title": task.title if task else None}


def list_sessions(db: Session, user: User, since: str) -> list[dict]:
    start = _when(since, "since")
    rows = db.scalars(select(FocusSession)
                      .where(FocusSession.owner_id == user.id, FocusSession.started_at >= start)
                      .order_by(FocusSession.started_at.desc()).limit(MAX_ROWS))
    return [_view(db, s) for s in rows]


def log_session(db: Session, user: User, data: dict) -> dict:
    started = _when(data.get("started_at"), "startedAt")
    now = datetime.now(timezone.utc)
    if started > now + timedelta(minutes=5) or started < now - MAX_AGE:
        raise FocusError("startedAt", "INVALID", "That session's start time is out of range.")
    seconds, planned = data.get("seconds") or 0, data.get("planned_seconds") or 0
    if not 1 <= seconds <= MAX_SECONDS or not 1 <= planned <= MAX_SECONDS:
        raise FocusError("seconds", "INVALID", "That session's length isn't valid.")

    course_id, task_id = None, None
    if data.get("task_id") is not None:
        task = db.scalar(select(Task).where(Task.id == int(data["task_id"]), Task.owner_id == user.id))
        if task is None:
            raise FocusError("taskId", "NOT_FOUND", "Task not found.")
        task_id, course_id = task.id, task.course_id
    if data.get("course_id") is not None:
        course = db.scalar(select(Course).where(Course.id == int(data["course_id"]), Course.owner_id == user.id))
        if course is None:
            raise FocusError("courseId", "NOT_FOUND", "Course not found.")
        course_id = course.id          # an explicit course wins over the task's

    s = FocusSession(owner_id=user.id, course_id=course_id, task_id=task_id, started_at=started,
                     seconds=seconds, planned_seconds=planned)
    db.add(s)
    db.commit()
    return _view(db, s)


def delete_session(db: Session, user: User, session_id) -> None:
    try:
        pk = int(session_id)
    except (TypeError, ValueError):
        raise FocusError(None, "NOT_FOUND", "Session not found.")
    s = db.scalar(select(FocusSession).where(FocusSession.id == pk, FocusSession.owner_id == user.id))
    if s is None:
        raise FocusError(None, "NOT_FOUND", "Session not found.")
    db.delete(s)
    db.commit()


# ---------------- GraphQL ----------------

type_defs = """
type FocusSession {
  id: ID!
  startedAt: String!
  seconds: Int!
  plannedSeconds: Int!
  course: Course
  taskTitle: String
}

input FocusInput { startedAt: String!, seconds: Int!, plannedSeconds: Int!, courseId: ID, taskId: ID }
type FocusPayload { session: FocusSession, errors: [UserError!]! }
type FocusDeletePayload { ok: Boolean!, errors: [UserError!]! }

extend type Query { focusSessions(since: String!): [FocusSession!]! }

extend type Mutation {
  logFocusSession(input: FocusInput!): FocusPayload!
  deleteFocusSession(id: ID!): FocusDeletePayload!
}
"""

query = QueryType()
mutation = MutationType()


def _write(info, fn, key: str):
    with SessionLocal() as db:
        user = current_user(info, db)
        try:
            result = fn(db, user)
        except FocusError as e:
            db.rollback()
            return {key: False if key == "ok" else None,
                    "errors": [{"field": e.field, "code": e.code, "message": e.message}]}
        return {key: True if key == "ok" else result, "errors": []}


@query.field("focusSessions")
def resolve_sessions(_, info, since):
    with SessionLocal() as db:
        user = current_user(info, db)
        try:
            return list_sessions(db, user, since)
        except FocusError as e:
            raise GraphQLError(e.message, extensions={"code": e.code})


@mutation.field("logFocusSession")
def resolve_log(_, info, input):
    return _write(info, lambda db, u: log_session(db, u, input), "session")


@mutation.field("deleteFocusSession")
def resolve_delete(_, info, id):
    return _write(info, lambda db, u: delete_session(db, u, id), "ok")