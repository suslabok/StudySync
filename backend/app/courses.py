import re
from datetime import date

from sqlalchemy import select, update
from sqlalchemy.orm import Session, selectinload

from app.models import Course, Semester

HEX_COLOR = re.compile(r"^#[0-9a-fA-F]{6}$")
DEFAULT_COLOR = "#2563eb"


class ApiError(Exception):
    def __init__(self, code: str, message: str, field: str | None = None):
        super().__init__(message)
        self.code, self.message, self.field = code, message, field


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


def update_semester(db: Session, user_id: int, semester_id: str, name: str,
                    start_date: date, end_date: date) -> Semester:
    try:
        pk = int(semester_id)
    except ValueError:
        raise ApiError("NOT_FOUND", "Semester not found")
    # filtering by owner: another user's id looks exactly like a missing one
    semester = db.scalar(select(Semester)
                         .where(Semester.id == pk, Semester.owner_id == user_id)
                         .options(selectinload(Semester.courses)))
    if semester is None:
        raise ApiError("NOT_FOUND", "Semester not found")
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


def create_course(db: Session, user_id: int, code: str, title: str,
                  color: str | None, instructor: str | None) -> Course:
    code, title = code.strip(), title.strip()
    if not code:
        raise ApiError("REQUIRED", "Course code is required", "code")
    if len(code) > 20:
        raise ApiError("TOO_LONG", "Course code must be 20 characters or fewer", "code")
    if not title:
        raise ApiError("REQUIRED", "Course title is required", "title")
    if len(title) > 200:
        raise ApiError("TOO_LONG", "Course title must be 200 characters or fewer", "title")
    color = color or DEFAULT_COLOR
    if not HEX_COLOR.match(color):
        raise ApiError("INVALID_COLOR", "Choose a valid colour", "color")
    instructor = (instructor or "").strip()[:200] or None

    semester = db.scalar(select(Semester).where(
        Semester.owner_id == user_id, Semester.is_current.is_(True)))
    if semester is None:
        raise ApiError("NO_SEMESTER", "Create a semester first")

    course = Course(owner_id=user_id, semester_id=semester.id, code=code,
                    title=title, color=color, instructor=instructor)
    db.add(course)
    db.commit()
    return course


def delete_course(db: Session, user_id: int, course_id: str) -> None:
    try:
        pk = int(course_id)
    except ValueError:
        raise ApiError("NOT_FOUND", "Course not found")
    # filtering by owner: another user's id looks exactly like a missing one
    course = db.scalar(select(Course).where(Course.id == pk, Course.owner_id == user_id))
    if course is None:
        raise ApiError("NOT_FOUND", "Course not found")
    db.delete(course)
    db.commit()