import uuid
from datetime import date, datetime
from sqlalchemy import CheckConstraint, Date, DateTime, ForeignKey, Index, String, Text, func, text
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.database import Base, TimestampMixin

class User(TimestampMixin, Base):
    __tablename__ = "user"
    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String(255), unique=True)
    password_hash: Mapped[str | None] = mapped_column(String(255))   # null for Google-only accounts
    google_sub: Mapped[str | None] = mapped_column(String(64), unique=True)
    display_name: Mapped[str] = mapped_column(String(100))
    timezone: Mapped[str] = mapped_column(String(64), default="UTC")
    is_active: Mapped[bool] = mapped_column(default=True)
    onboarded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    avatar_file: Mapped[str | None] = mapped_column(String(64))
    
class RefreshToken(TimestampMixin, Base):
    __tablename__ = "refresh_token"
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("user.id", ondelete="CASCADE"))
    family_id: Mapped[uuid.UUID] = mapped_column(index=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

class Semester(TimestampMixin, Base):
    __tablename__ = "semester"
    id: Mapped[int] = mapped_column(primary_key=True)
    owner_id: Mapped[int] = mapped_column(ForeignKey("user.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(100))
    start_date: Mapped[date] = mapped_column(Date)
    end_date: Mapped[date] = mapped_column(Date)
    is_current: Mapped[bool] = mapped_column(default=False, server_default=text("false"))

    courses: Mapped[list["Course"]] = relationship(
        back_populates="semester", cascade="all, delete-orphan", order_by="Course.code")

    __table_args__ = (
        # at most one current semester per user
        Index("uq_semester_one_current", "owner_id", unique=True, postgresql_where=text("is_current")),
        CheckConstraint("end_date > start_date", name="ck_semester_dates"),
    )


class Course(TimestampMixin, Base):
    __tablename__ = "course"
    id: Mapped[int] = mapped_column(primary_key=True)
    owner_id: Mapped[int] = mapped_column(ForeignKey("user.id", ondelete="CASCADE"), index=True)
    semester_id: Mapped[int] = mapped_column(ForeignKey("semester.id", ondelete="CASCADE"), index=True)
    code: Mapped[str] = mapped_column(String(20))
    title: Mapped[str] = mapped_column(String(200))
    color: Mapped[str] = mapped_column(String(7), default="#2563eb")
    instructor: Mapped[str | None] = mapped_column(String(200))

    # sharing: share_mode is None while the course is private
    share_mode: Mapped[str | None] = mapped_column(String(10))
    join_code: Mapped[str | None] = mapped_column(String(8), unique=True)
    source_course_id: Mapped[int | None] = mapped_column(
        ForeignKey("course.id", ondelete="SET NULL"), index=True)

    __table_args__ = (
        CheckConstraint("share_mode IN ('classroom','group')", name="ck_course_share_mode"),
    )

    semester: Mapped[Semester] = relationship(back_populates="courses")
class Post(Base):
    __tablename__ = "post"
    __table_args__ = (Index("ix_post_course_created", "course_id", "created_at"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    course_id: Mapped[int] = mapped_column(ForeignKey("course.id", ondelete="CASCADE"))
    author_id: Mapped[int] = mapped_column(ForeignKey("user.id", ondelete="CASCADE"))
    body: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Comment(Base):
    __tablename__ = "comment"

    id: Mapped[int] = mapped_column(primary_key=True)
    post_id: Mapped[int] = mapped_column(ForeignKey("post.id", ondelete="CASCADE"), index=True)
    author_id: Mapped[int] = mapped_column(ForeignKey("user.id", ondelete="CASCADE"))
    body: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())