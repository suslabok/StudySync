"""Tasks: personal ones, plus the per-student copies of course assignments.

An assigned task (assignment_id set) is managed by the assignment: its owner may only
change its status. Personal tasks are fully editable.
"""
from datetime import date, datetime, timedelta, timezone

from sqlalchemy import func, select
from sqlalchemy.orm import Session, joinedload

from app.models import Assignment, Course, Task, User

STATUSES = ("todo", "doing", "done")


class TaskError(Exception):
    def __init__(self, field: str | None, code: str, message: str):
        self.field, self.code, self.message = field, code, message


def clean_fields(data: dict) -> dict:
    """Validate the fields shared by tasks and assignments."""
    title = (data.get("title") or "").strip()
    if not title:
        raise TaskError("title", "REQUIRED", "Give it a title.")
    if len(title) > 200:
        raise TaskError("title", "TOO_LONG", "Keep the title under 200 characters.")
    notes = (data.get("notes") or "").strip() or None
    if notes and len(notes) > 5000:
        raise TaskError("notes", "TOO_LONG", "Notes are limited to 5000 characters.")
    priority = data.get("priority") or 2     # the app no longer asks for one
    if priority not in (1, 2, 3):
        raise TaskError("priority", "INVALID", "Priority must be 1, 2 or 3.")
    due = data.get("due_date")
    if isinstance(due, str):
        try:
            due = date.fromisoformat(due)
        except ValueError:
            raise TaskError("dueDate", "INVALID", "Use a valid date.")
    return {"title": title, "notes": notes, "priority": priority, "due_date": due}


def _own_course_id(db: Session, user: User, course_id) -> int | None:
    if course_id in (None, ""):
        return None
    try:
        course = db.get(Course, int(course_id))
    except (TypeError, ValueError):
        course = None
    if course is None or course.owner_id != user.id:
        raise TaskError("courseId", "NOT_FOUND", "That course does not exist.")
    return course.id


def get_task(db: Session, user: User, task_id) -> Task:
    try:
        task = db.get(Task, int(task_id))
    except (TypeError, ValueError):
        task = None
    if task is None or task.owner_id != user.id:
        raise TaskError(None, "NOT_FOUND", "Task not found.")
    return task


def _sort_key(t: Task):
    # open first, then soonest due (no date last), then highest priority
    return (t.status == "done", t.due_date is None, t.due_date or date.max, -t.priority, t.id)


def list_tasks(db: Session, user: User, status: str | None = None, course_id=None) -> list[Task]:
    q = select(Task).options(joinedload(Task.course)).where(Task.owner_id == user.id)
    if status:
        q = q.where(Task.status == status)
    if course_id not in (None, ""):
        q = q.where(Task.course_id == int(course_id))
    return sorted(db.scalars(q).unique().all(), key=_sort_key)


def due_soon(db: Session, user: User, days: int = 7, limit: int = 5) -> list[Task]:
    """Open tasks that are overdue or due within `days` days."""
    horizon = date.today() + timedelta(days=max(0, days))
    q = (select(Task).options(joinedload(Task.course))
         .where(Task.owner_id == user.id, Task.status != "done",
                Task.due_date.is_not(None), Task.due_date <= horizon))
    return sorted(db.scalars(q).unique().all(), key=_sort_key)[: max(1, limit)]


def create_task(db: Session, user: User, data: dict) -> Task:
    fields = clean_fields(data)
    task = Task(owner_id=user.id, course_id=_own_course_id(db, user, data.get("course_id")), **fields)
    db.add(task)
    db.commit()
    db.refresh(task)
    return task


def update_task(db: Session, user: User, task_id, data: dict) -> Task:
    task = get_task(db, user, task_id)
    if task.assignment_id is not None:
        raise TaskError(None, "ASSIGNED", "Assigned work is edited by whoever set it. You can change its status.")
    for k, v in clean_fields(data).items():
        setattr(task, k, v)
    task.course_id = _own_course_id(db, user, data.get("course_id"))
    db.commit()
    db.refresh(task)
    return task


def set_status(db: Session, user: User, task_id, status: str) -> Task:
    if status not in STATUSES:
        raise TaskError("status", "INVALID", "Status must be todo, doing or done.")
    task = get_task(db, user, task_id)
    if task.assignment_id is not None:
        raise TaskError("status", "ASSIGNED", "Hand in your work to finish assigned work.")
    task.status = status
    task.completed_at = datetime.now(timezone.utc) if status == "done" else None
    db.commit()
    db.refresh(task)
    return task


def delete_task(db: Session, user: User, task_id) -> None:
    task = get_task(db, user, task_id)
    # an assigned task can only go once its course link is gone (you deleted the course copy)
    if task.assignment_id is not None and task.course_id is not None:
        raise TaskError(None, "ASSIGNED", "Assigned work can't be deleted. Leave the course to remove it.")
    db.delete(task)
    db.commit()


# ---- hooks used by sharing.py (kept here so tasks.py never imports sharing) ----

def task_from_assignment(a: Assignment, owner_id: int, course_id: int | None) -> Task:
    return Task(owner_id=owner_id, course_id=course_id, assignment_id=a.id, title=a.title,
                notes=a.notes, priority=a.priority, due_date=a.due_date)


def give_member_assignments(db: Session, user: User, member_course: Course, root: Course) -> None:
    """A user just joined `root`: hand them every assignment already set on it."""
    for a in db.scalars(select(Assignment).where(Assignment.course_id == root.id)):
        if db.scalar(select(Task.id).where(Task.owner_id == user.id, Task.assignment_id == a.id)) is None:
            db.add(task_from_assignment(a, user.id, member_course.id))


def drop_member_assignments_for(db: Session, user_id: int, root_id: int) -> None:
    """A user left `root`: remove their copies of its assignments."""
    mine = select(Assignment.id).where(Assignment.course_id == root_id)
    db.query(Task).filter(Task.owner_id == user_id, Task.assignment_id.in_(mine)).delete(synchronize_session=False)


def drop_member_assignments(db: Session, user: User, root_id: int) -> None:
    drop_member_assignments_for(db, user.id, root_id)


def drop_course_assignments(db: Session, root_id: int) -> None:
    """`root` stopped being shared: remove its assignments and everyone's copies."""
    mine = select(Assignment.id).where(Assignment.course_id == root_id)
    db.query(Task).filter(Task.assignment_id.in_(mine)).delete(synchronize_session=False)
    db.query(Assignment).filter(Assignment.course_id == root_id).delete(synchronize_session=False)


# Course assignments. classroom: only the owner (teacher) assigns, students receive.
# group: any member assigns and everyone, the owner included, receives.

def _sh():
    """sharing.py imports this module, so import it lazily to avoid a cycle."""
    from app import sharing
    return sharing


def _access(db: Session, user: User, course_id) -> tuple[Course, bool]:
    try:
        return _sh()._stream_access(db, user, course_id)
    except _sh().ShareError as e:
        raise TaskError(e.field, e.code, e.message)


def _assignment_access(db: Session, user: User, assignment_id) -> tuple[Assignment, Course, bool]:
    """(assignment, root course, may edit). Users outside the course get NOT_FOUND."""
    try:
        a = db.get(Assignment, int(assignment_id))
    except (TypeError, ValueError):
        a = None
    root = db.get(Course, a.course_id) if a else None
    if a is None or root is None or root.share_mode is None:
        raise TaskError(None, "NOT_FOUND", "Assignment not found.")
    is_owner = root.owner_id == user.id
    in_course = is_owner or db.scalar(select(Course.id).where(
        Course.owner_id == user.id, Course.source_course_id == root.id)) is not None
    if not in_course:
        raise TaskError(None, "NOT_FOUND", "Assignment not found.")
    return a, root, is_owner or a.author_id == user.id


def _recipients(db: Session, root: Course) -> list[tuple[int, int]]:
    """(user id, that user's own course id) for everyone who should receive the work."""
    out = list(db.execute(select(Course.owner_id, Course.id).where(Course.source_course_id == root.id)).all())
    if root.share_mode == "group":
        out.append((root.owner_id, root.id))
    return [(u, c) for u, c in out]


def _serialize(db: Session, user: User, items: list[Assignment], root: Course, owner: bool) -> list[dict]:
    ids = [a.id for a in items]
    counts: dict[int, dict[str, int]] = {i: {"total": 0, "done": 0} for i in ids}
    mine: dict[int, Task] = {}
    if ids:
        for aid, status, n in db.execute(select(Task.assignment_id, Task.status, func.count())
                                         .where(Task.assignment_id.in_(ids)).group_by(Task.assignment_id, Task.status)):
            counts[aid]["total"] += n
            if status == "done":
                counts[aid]["done"] += n
        mine = {t.assignment_id: t for t in db.scalars(
            select(Task).where(Task.owner_id == user.id, Task.assignment_id.in_(ids)))}
    authors = {u.id: u for u in db.scalars(select(User).where(User.id.in_({a.author_id for a in items})))} if items else {}
    out = []
    for a in items:
        can_edit = owner or a.author_id == user.id
        show = can_edit or root.share_mode == "group"   # students in a classroom don't see class progress
        t = mine.get(a.id)
        out.append({
            "id": a.id, "title": a.title, "notes": a.notes, "priority": a.priority, "due_date": a.due_date,
            "created_at": a.created_at.isoformat(), "author": _sh().person(authors[a.author_id]),
            "can_edit": can_edit,
            "done_count": counts[a.id]["done"] if show else None, "total": counts[a.id]["total"] if show else None,
            "my_task_id": t.id if t else None, "my_status": t.status if t else None,
        })
    return out


def list_assignments(db: Session, user: User, course_id) -> list[dict]:
    root, owner = _access(db, user, course_id)
    items = sorted(db.scalars(select(Assignment).where(Assignment.course_id == root.id)),
                   key=lambda a: (a.due_date is None, a.due_date or date.max, -a.id))
    return _serialize(db, user, items, root, owner)


def create_assignment(db: Session, user: User, course_id, data: dict) -> dict:
    root, owner = _access(db, user, course_id)
    if root.share_mode == "classroom" and not owner:
        raise TaskError(None, "FORBIDDEN", "Only the teacher can assign work.")
    a = Assignment(course_id=root.id, author_id=user.id, **clean_fields(data))
    db.add(a)
    db.flush()
    for uid, cid in _recipients(db, root):
        db.add(task_from_assignment(a, uid, cid))
    db.commit()
    return _serialize(db, user, [a], root, owner)[0]


def update_assignment(db: Session, user: User, assignment_id, data: dict) -> dict:
    a, root, can_edit = _assignment_access(db, user, assignment_id)
    if not can_edit:
        raise TaskError(None, "FORBIDDEN", "Only whoever set this can edit it.")
    fields = clean_fields(data)
    for k, v in fields.items():
        setattr(a, k, v)
    db.query(Task).filter(Task.assignment_id == a.id).update(fields, synchronize_session=False)  # keeps statuses
    db.commit()
    return _serialize(db, user, [a], root, root.owner_id == user.id)[0]


def delete_assignment(db: Session, user: User, assignment_id) -> None:
    a, _, can_edit = _assignment_access(db, user, assignment_id)
    if not can_edit:
        raise TaskError(None, "FORBIDDEN", "Only whoever set this can delete it.")
    db.query(Task).filter(Task.assignment_id == a.id).delete(synchronize_session=False)
    db.delete(a)
    db.commit()