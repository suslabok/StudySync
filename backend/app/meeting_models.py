"""One Google Meet link per course.

Add ONE line at the bottom of app/models.py so Alembic sees it:
    from app import meeting_models  # noqa: F401,E402
"""
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class CourseMeeting(Base):
    """Kept against the ORIGINAL course (the one that was shared), so everyone who joined sees the same link."""

    __tablename__ = "course_meeting"

    course_id: Mapped[int] = mapped_column(ForeignKey("course.id", ondelete="CASCADE"), primary_key=True)
    url: Mapped[str] = mapped_column(String(200))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())