"""Tables for the Study hub: material a student uploads, and what is generated from it.

Add ONE line at the bottom of app/models.py so Alembic sees these tables:
    from app import study_models  # noqa: F401,E402
"""
from datetime import datetime

from sqlalchemy import (
    JSON, Boolean, CheckConstraint, DateTime, ForeignKey, Index, Integer, String, Text, func,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class StudyMaterial(Base):
    """Text the student studies from: pasted, or pulled out of an uploaded file. Only the text is kept."""

    __tablename__ = "study_material"
    __table_args__ = (
        CheckConstraint("source_kind IN ('text','file')", name="ck_study_material_source"),
        Index("ix_study_material_owner_created", "owner_id", "created_at"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    owner_id: Mapped[int] = mapped_column(ForeignKey("user.id", ondelete="CASCADE"))
    course_id: Mapped[int | None] = mapped_column(ForeignKey("course.id", ondelete="SET NULL"), index=True)
    title: Mapped[str] = mapped_column(String(150))
    source_kind: Mapped[str] = mapped_column(String(10))
    file_name: Mapped[str | None] = mapped_column(String(200))
    content: Mapped[str] = mapped_column(Text)
    notes: Mapped[dict | None] = mapped_column(JSON)              # {"summary": str, "points": [str], "terms": [{"term","meaning"}]}
    generated_by: Mapped[str | None] = mapped_column(String(10))  # "ai" or "basic"
    generated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class StudyQuestion(Base):
    __tablename__ = "study_question"
    __table_args__ = (
        CheckConstraint("kind IN ('mcq','short')", name="ck_study_question_kind"),
        Index("ix_study_question_material", "material_id", "position"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    material_id: Mapped[int] = mapped_column(ForeignKey("study_material.id", ondelete="CASCADE"))
    kind: Mapped[str] = mapped_column(String(5))
    position: Mapped[int] = mapped_column(Integer)
    prompt: Mapped[str] = mapped_column(Text)
    options: Mapped[list | None] = mapped_column(JSON)            # mcq: four strings
    answer_index: Mapped[int | None] = mapped_column(Integer)     # mcq: which option is right
    reference: Mapped[str | None] = mapped_column(Text)          # short: a model answer
    explanation: Mapped[str | None] = mapped_column(Text)


class StudyCard(Base):
    __tablename__ = "study_card"
    __table_args__ = (Index("ix_study_card_material", "material_id", "position"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    material_id: Mapped[int] = mapped_column(ForeignKey("study_material.id", ondelete="CASCADE"))
    position: Mapped[int] = mapped_column(Integer)
    front: Mapped[str] = mapped_column(Text)
    back: Mapped[str] = mapped_column(Text)
    right: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    wrong: Mapped[int] = mapped_column(Integer, default=0, server_default="0")


class StudyAttempt(Base):
    """One finished quiz or short-answer round. `score` and `total` are worked out on the server."""

    __tablename__ = "study_attempt"
    __table_args__ = (
        CheckConstraint("kind IN ('quiz','short')", name="ck_study_attempt_kind"),
        CheckConstraint("total >= 1 AND score >= 0 AND score <= total", name="ck_study_attempt_score"),
        Index("ix_study_attempt_material", "material_id", "created_at"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    material_id: Mapped[int] = mapped_column(ForeignKey("study_material.id", ondelete="CASCADE"))
    owner_id: Mapped[int] = mapped_column(ForeignKey("user.id", ondelete="CASCADE"))
    kind: Mapped[str] = mapped_column(String(5))
    score: Mapped[int] = mapped_column(Integer)       # short answers are marked 0, 1 or 2 each, so score is in half-marks:
    total: Mapped[int] = mapped_column(Integer)       # quiz: right/total.  short: points/(2 x questions).
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())