import uuid
from datetime import date, datetime

from sqlalchemy import (
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy import SmallInteger
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base, TimestampMixin


class User(TimestampMixin, Base):
    __tablename__ = "user"

    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String(255), unique=True)
    password_hash: Mapped[str | None] = mapped_column(String(255))
    google_sub: Mapped[str | None] = mapped_column(String(64), unique=True)
    display_name: Mapped[str] = mapped_column(String(100))
    timezone: Mapped[str] = mapped_column(String(64), default="UTC")
    is_active: Mapped[bool] = mapped_column(default=True)
    onboarded_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True)
    )
    avatar_file: Mapped[str | None] = mapped_column(String(64))


class RefreshToken(TimestampMixin, Base):
    __tablename__ = "refresh_token"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("user.id", ondelete="CASCADE")
    )
    family_id: Mapped[uuid.UUID] = mapped_column(index=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    revoked_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True)
    )


class Semester(TimestampMixin, Base):
    __tablename__ = "semester"

    id: Mapped[int] = mapped_column(primary_key=True)
    owner_id: Mapped[int] = mapped_column(
        ForeignKey("user.id", ondelete="CASCADE"), index=True
    )
    name: Mapped[str] = mapped_column(String(100))
    start_date: Mapped[date] = mapped_column(Date)
    end_date: Mapped[date] = mapped_column(Date)
    is_current: Mapped[bool] = mapped_column(
        default=False, server_default=text("false")
    )

    courses: Mapped[list["Course"]] = relationship(
        back_populates="semester",
        cascade="all, delete-orphan",
        order_by="Course.code",
    )

    __table_args__ = (
        Index(
            "uq_semester_one_current",
            "owner_id",
            unique=True,
            postgresql_where=text("is_current"),
        ),
        CheckConstraint(
            "end_date > start_date",
            name="ck_semester_dates",
        ),
    )


class Course(TimestampMixin, Base):
    __tablename__ = "course"

    id: Mapped[int] = mapped_column(primary_key=True)
    owner_id: Mapped[int] = mapped_column(
        ForeignKey("user.id", ondelete="CASCADE"), index=True
    )
    semester_id: Mapped[int] = mapped_column(
        ForeignKey("semester.id", ondelete="CASCADE"), index=True
    )
    code: Mapped[str] = mapped_column(String(20))
    title: Mapped[str] = mapped_column(String(200))
    color: Mapped[str] = mapped_column(
        String(7), default="#2563eb"
    )

    share_mode: Mapped[str | None] = mapped_column(String(10))
    join_code: Mapped[str | None] = mapped_column(
        String(8), unique=True
    )
    source_course_id: Mapped[int | None] = mapped_column(
        ForeignKey("course.id", ondelete="SET NULL"), index=True
    )

    __table_args__ = (
        CheckConstraint(
            "share_mode IN ('classroom', 'group')",
            name="ck_course_share_mode",
        ),
    )

    semester: Mapped["Semester"] = relationship(
        back_populates="courses"
    )


class Post(Base):
    __tablename__ = "post"

    __table_args__ = (
        Index("ix_post_course_created", "course_id", "created_at"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    course_id: Mapped[int] = mapped_column(
        ForeignKey("course.id", ondelete="CASCADE")
    )
    author_id: Mapped[int] = mapped_column(
        ForeignKey("user.id", ondelete="CASCADE")
    )
    body: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class Comment(Base):
    __tablename__ = "comment"

    id: Mapped[int] = mapped_column(primary_key=True)
    post_id: Mapped[int] = mapped_column(
        ForeignKey("post.id", ondelete="CASCADE"), index=True
    )
    author_id: Mapped[int] = mapped_column(
        ForeignKey("user.id", ondelete="CASCADE")
    )
    body: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class Assignment(Base):
    """Work assigned on a shared course."""

    __tablename__ = "assignment"

    id: Mapped[int] = mapped_column(primary_key=True)
    course_id: Mapped[int] = mapped_column(
        ForeignKey("course.id", ondelete="CASCADE"), index=True
    )
    author_id: Mapped[int] = mapped_column(
        ForeignKey("user.id", ondelete="CASCADE")
    )
    title: Mapped[str] = mapped_column(String(200))
    notes: Mapped[str | None] = mapped_column(Text)
    priority: Mapped[int] = mapped_column(
        SmallInteger, default=2, server_default=text("2")
    )
    due_date: Mapped[date | None] = mapped_column(Date)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    __table_args__ = (
        CheckConstraint(
            "priority BETWEEN 1 AND 3",
            name="ck_assignment_priority",
        ),
    )


class Task(Base):
    """Personal task or an individual student's assignment copy."""

    __tablename__ = "task"

    __table_args__ = (
        CheckConstraint(
            "status IN ('todo', 'doing', 'done')",
            name="ck_task_status",
        ),
        CheckConstraint(
            "priority BETWEEN 1 AND 3",
            name="ck_task_priority",
        ),
        UniqueConstraint(
            "owner_id",
            "assignment_id",
            name="uq_task_assignment_owner",
        ),
        Index(
            "ix_task_owner_status_due",
            "owner_id",
            "status",
            "due_date",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    owner_id: Mapped[int] = mapped_column(
        ForeignKey("user.id", ondelete="CASCADE"), index=True
    )
    course_id: Mapped[int | None] = mapped_column(
        ForeignKey("course.id", ondelete="SET NULL"), index=True
    )
    assignment_id: Mapped[int | None] = mapped_column(
        ForeignKey("assignment.id", ondelete="CASCADE"), index=True
    )
    title: Mapped[str] = mapped_column(String(200))
    notes: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(
        String(10), default="todo", server_default="todo"
    )
    priority: Mapped[int] = mapped_column(
        SmallInteger, default=2, server_default=text("2")
    )
    due_date: Mapped[date | None] = mapped_column(Date)
    completed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True)
    )
    # the student's written answer, and when they handed it in (NULL = not submitted)
    answer: Mapped[str | None] = mapped_column(Text)
    submitted_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True)
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    course: Mapped["Course | None"] = relationship(
        foreign_keys=[course_id],
        lazy="select",
    )


class TaskFile(Base):
    """A file attached to a stream post, an assignment (by whoever set it) or one student's task (their work)."""

    __tablename__ = "task_file"

    __table_args__ = (
        CheckConstraint(
            "(CASE WHEN task_id IS NULL THEN 0 ELSE 1 END)"
            " + (CASE WHEN assignment_id IS NULL THEN 0 ELSE 1 END)"
            " + (CASE WHEN post_id IS NULL THEN 0 ELSE 1 END) = 1",
            name="ck_task_file_one_parent",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    uploader_id: Mapped[int] = mapped_column(
        ForeignKey("user.id", ondelete="CASCADE"), index=True
    )
    task_id: Mapped[int | None] = mapped_column(
        ForeignKey("task.id", ondelete="CASCADE"), index=True
    )
    assignment_id: Mapped[int | None] = mapped_column(
        ForeignKey("assignment.id", ondelete="CASCADE"), index=True
    )
    post_id: Mapped[int | None] = mapped_column(
        ForeignKey("post.id", ondelete="CASCADE"), index=True
    )
    storage_key: Mapped[str] = mapped_column(String(64), unique=True)  # random name on disk, never the user's
    original_name: Mapped[str] = mapped_column(String(255))
    mime_type: Mapped[str] = mapped_column(String(100))
    size_bytes: Mapped[int] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class Event(Base):
    """Something the user puts on their own calendar: an exam, a break, an event."""

    __tablename__ = "event"

    __table_args__ = (
        CheckConstraint("kind IN ('event', 'exam', 'break')", name="ck_event_kind"),
        CheckConstraint("end_date IS NULL OR end_date >= start_date", name="ck_event_dates"),
        Index("ix_event_owner_start", "owner_id", "start_date"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    owner_id: Mapped[int] = mapped_column(
        ForeignKey("user.id", ondelete="CASCADE")
    )
    title: Mapped[str] = mapped_column(String(200))
    notes: Mapped[str | None] = mapped_column(Text)
    kind: Mapped[str] = mapped_column(
        String(10), default="event", server_default="event"
    )
    start_date: Mapped[date] = mapped_column(Date)
    end_date: Mapped[date | None] = mapped_column(Date)  # NULL = a single day
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )