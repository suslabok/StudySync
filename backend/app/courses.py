import re
from datetime import date

from sqlalchemy import select, update
from sqlalchemy.orm import Session, selectinload

from app import tasks as task_svc
from app.models import Course, Post, Semester, Task

HEX_COLOR = re.compile(r"^#[0-9a-fA-F]{6}$")
DEFAULT_COLOR = "#2563eb"


class ApiError(Exception):
    def __init__(self, code: str, message: str, field: str | None = None):
        super().__init__(message)
        self.code, self.message, self.field = code, message, field


def _pk(value, message: str) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        raise ApiError("NOT_FOUND", message)


def list_semesters(db: Session, user_id: int) -> list[Semester]:
    return list(db.scalars(
        select(Semester).where(Semester.owner_id == user_id)
        .options(selectinload(Semester.courses))
        .order_by(Semester.start_date.desc())))


def current_semester(db: Session, user_id: int) -> Semester | None:
    return db.scalar(
        select(Semester).where(Semester.owner_id == user_id, Semester.is_current.is_(True))
        .options(selectinload(Semester.courses)))


def _check_semester(name: str, start_date: date, end_date: date) -> str:
    name = name.strip()
    if not name:
        raise ApiError("REQUIRED", "Semester name is required", "name")
    if len(name) > 100:
        raise ApiError("TOO_LONG", "Semester name must be 100 characters or fewer", "name")
    if end_date <= start_date:
        raise ApiError("INVALID_DATES", "End date must be after the start date", "endDate")
    return name


def _own_semester(db: Session, user_id: int, semester_id) -> Semester:
    pk = _pk(semester_id, "Semester not found")
    # filtering by owner: another user's id looks exactly like a missing one
    semester = db.scalar(select(Semester)
                         .where(Semester.id == pk, Semester.owner_id == user_id)
                         .options(selectinload(Semester.courses)))
    if semester is None:
        raise ApiError("NOT_FOUND", "Semester not found")
    return semester


def update_semester(db: Session, user_id: int, semester_id: str, name: str,
                    start_date: date, end_date: date) -> Semester:
    semester = _own_semester(db, user_id, semester_id)       # current or past, both can be edited
    semester.name = _check_semester(name, start_date, end_date)
    semester.start_date, semester.end_date = start_date, end_date
    db.commit()
    return semester


def create_semester(db: Session, user_id: int, name: str, start_date: date, end_date: date) -> Semester:
    name = _check_semester(name, start_date, end_date)
    # a new semester becomes the current one
    db.execute(update(Semester)
               .where(Semester.owner_id == user_id, Semester.is_current.is_(True))
               .values(is_current=False))
    semester = Semester(owner_id=user_id, name=name, start_date=start_date,
                        end_date=end_date, is_current=True, courses=[])
    db.add(semester)
    db.commit()
    return semester


def delete_semester(db: Session, user_id: int, semester_id: str) -> None:
    """Delete a semester (current or past) with its courses. Tasks stay, without a course link."""
    semester = _own_semester(db, user_id, semester_id)
    for course in list(semester.courses):
        _release_course(db, user_id, course)
    db.delete(semester)
    db.commit()


def _check_course(code: str, title: str, color: str | None, default: str) -> tuple[str, str, str]:
    code, title = code.strip(), title.strip()
    if not code:
        raise ApiError("REQUIRED", "Course code is required", "code")
    if len(code) > 20:
        raise ApiError("TOO_LONG", "Course code must be 20 characters or fewer", "code")
    if not title:
        raise ApiError("REQUIRED", "Course title is required", "title")
    if len(title) > 200:
        raise ApiError("TOO_LONG", "Course title must be 200 characters or fewer", "title")
    color = color or default
    if not HEX_COLOR.match(color):
        raise ApiError("INVALID_COLOR", "Choose a valid colour", "color")
    return code, title, color


def create_course(db: Session, user_id: int, code: str, title: str,
                  color: str | None) -> Course:
    code, title, color = _check_course(code, title, color, DEFAULT_COLOR)
    semester = db.scalar(select(Semester).where(
        Semester.owner_id == user_id, Semester.is_current.is_(True)))
    if semester is None:
        raise ApiError("NO_SEMESTER", "Create a semester first")

    course = Course(owner_id=user_id, semester_id=semester.id, code=code,
                    title=title, color=color)
    db.add(course)
    db.commit()
    return course


def _own_course(db: Session, user_id: int, course_id) -> Course:
    pk = _pk(course_id, "Course not found")
    course = db.scalar(select(Course).where(Course.id == pk, Course.owner_id == user_id))
    if course is None:
        raise ApiError("NOT_FOUND", "Course not found")
    return course


def update_course(db: Session, user_id: int, course_id: str, code: str, title: str,
                  color: str | None) -> Course:
    """Edit a course in any semester. Only your own copy changes, also for a joined course."""
    course = _own_course(db, user_id, course_id)
    course.code, course.title, course.color = _check_course(code, title, color, course.color)
    db.commit()
    return course


def _release_course(db: Session, user_id: int, course: Course) -> None:
    """Clean up everything that points at a course before it is deleted."""
    if course.source_course_id is not None:
        # a copy of someone else's shared course: drop the assignment tasks it brought along
        task_svc.drop_member_assignments_for(db, user_id, course.source_course_id)
    elif course.share_mode is not None:
        # a shared original: end the sharing (stream, assignments, links from other people's copies)
        db.query(Post).filter(Post.course_id == course.id).delete(synchronize_session=False)
        db.query(Course).filter(Course.source_course_id == course.id).update(
            {Course.source_course_id: None}, synchronize_session=False)
        task_svc.drop_course_assignments(db, course.id)
    # personal tasks keep existing, they just lose the course
    db.query(Task).filter(Task.course_id == course.id).update({Task.course_id: None}, synchronize_session=False)


def delete_course(db: Session, user_id: int, course_id: str) -> None:
    course = _own_course(db, user_id, course_id)
    _release_course(db, user_id, course)
    db.delete(course)
    db.commit()