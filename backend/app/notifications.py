"""In-app notifications and due-date reminders.

Notifications are rows written when something happens in a shared course (see `notify`). Reminders are not
stored: they are worked out from the user's own open tasks each time the bell is opened, so there is no
scheduler to run. Register in api.py: notifications.type_defs, notifications.query, notifications.mutation.
"""
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from ariadne import MutationType, QueryType
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.database import SessionLocal
from app.models import Course, Notification, Task, User
from app.schema import current_user

KEEP_DAYS = 60
FEED_LIMIT = 40
REMIND_WITHIN_DAYS = 2     # due today, tomorrow or the day after, plus anything overdue


def course_members(db: Session, root: Course) -> list[int]:
    """Everyone in a shared course: the owner and everyone who joined it."""
    joined = db.scalars(select(Course.owner_id).where(Course.source_course_id == root.id)).all()
    return [root.owner_id, *joined]


def notify(db: Session, user_ids, kind: str, title: str, body: str | None = None,
           root_course_id: int | None = None, skip: int | None = None) -> None:
    """Queue a notification for each user (except `skip`, normally whoever did it). The caller commits."""
    body = (body or "").strip()
    for uid in dict.fromkeys(user_ids):
        if uid == skip:
            continue
        db.add(Notification(user_id=uid, kind=kind, title=title[:200], body=body[:300] or None,
                            root_course_id=root_course_id))
    cutoff = datetime.now(timezone.utc) - timedelta(days=KEEP_DAYS)
    db.query(Notification).filter(Notification.created_at < cutoff).delete(synchronize_session=False)


def _own_course_ids(db: Session, user: User, root_ids: set[int]) -> dict[int, int]:
    """root course id -> the course id this user opens it with."""
    if not root_ids:
        return {}
    out = {}
    for c in db.scalars(select(Course).where(Course.owner_id == user.id,
                                             (Course.id.in_(root_ids)) | (Course.source_course_id.in_(root_ids)))):
        out[c.source_course_id or c.id] = c.id
    return out


def _today(user: User) -> date:
    try:
        return datetime.now(ZoneInfo(user.timezone or "UTC")).date()
    except Exception:
        return datetime.now(timezone.utc).date()


def feed(db: Session, user: User) -> dict:
    rows = db.scalars(select(Notification).where(Notification.user_id == user.id)
                      .order_by(Notification.created_at.desc(), Notification.id.desc()).limit(FEED_LIMIT)).all()
    own = _own_course_ids(db, user, {n.root_course_id for n in rows if n.root_course_id})
    items = [{"id": n.id, "kind": n.kind, "title": n.title, "body": n.body, "read": n.read_at is not None,
              "created_at": n.created_at.isoformat(), "course_id": own.get(n.root_course_id)} for n in rows]

    today = _today(user)
    tasks = db.execute(select(Task, Course.code).outerjoin(Course, Course.id == Task.course_id)
                       .where(Task.owner_id == user.id, Task.status != "done", Task.due_date.is_not(None),
                              Task.due_date <= today + timedelta(days=REMIND_WITHIN_DAYS))
                       .order_by(Task.due_date, Task.id).limit(30)).all()
    reminders = [{"task_id": t.id, "title": t.title, "course_code": code, "due_date": t.due_date.isoformat(),
                  "overdue": t.due_date < today} for t, code in tasks]
    return {"unread": sum(1 for i in items if not i["read"]), "items": items, "reminders": reminders}


def mark_read(db: Session, user: User, notification_id=None) -> None:
    q = update(Notification).where(Notification.user_id == user.id, Notification.read_at.is_(None))
    if notification_id is not None:
        try:
            q = q.where(Notification.id == int(notification_id))
        except (TypeError, ValueError):
            return
    db.execute(q.values(read_at=datetime.now(timezone.utc)))
    db.commit()


# ---------------- GraphQL ----------------

type_defs = """
type Notification { id: ID!, kind: String!, title: String!, body: String, read: Boolean!, createdAt: String!, courseId: ID }
type Reminder { taskId: ID!, title: String!, courseCode: String, dueDate: String!, overdue: Boolean! }
type NotificationFeed { unread: Int!, items: [Notification!]!, reminders: [Reminder!]! }

extend type Query { notifications: NotificationFeed! }
extend type Mutation {
  markNotificationRead(id: ID!): Boolean!
  markAllNotificationsRead: Boolean!
}
"""

query = QueryType()
mutation = MutationType()


@query.field("notifications")
def resolve_feed(_, info):
    with SessionLocal() as db:
        return feed(db, current_user(info, db))


@mutation.field("markNotificationRead")
def resolve_read(_, info, id):
    with SessionLocal() as db:
        mark_read(db, current_user(info, db), id)
        return True


@mutation.field("markAllNotificationsRead")
def resolve_read_all(_, info):
    with SessionLocal() as db:
        mark_read(db, current_user(info, db))
        return True