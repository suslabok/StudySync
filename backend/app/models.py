import uuid
from datetime import date, datetime
from sqlalchemy import CheckConstraint, Date, DateTime, ForeignKey, Index, String, text
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

    semester: Mapped[Semester] = relationship(back_populates="courses")