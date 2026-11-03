"""study hub

Revision ID: e93591e0561b
Revises: 09e52ba99692
Create Date: 2026-11-03 13:22:33.317726

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'e93591e0561b'
down_revision: Union[str, Sequence[str], None] = '09e52ba99692'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "study_material",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("owner_id", sa.Integer(), sa.ForeignKey("user.id", ondelete="CASCADE"), nullable=False),
        sa.Column("course_id", sa.Integer(), sa.ForeignKey("course.id", ondelete="SET NULL")),
        sa.Column("title", sa.String(150), nullable=False),
        sa.Column("source_kind", sa.String(10), nullable=False),
        sa.Column("file_name", sa.String(200)),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("notes", sa.JSON()),
        sa.Column("generated_by", sa.String(10)),
        sa.Column("generated_at", sa.DateTime(timezone=True)),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("source_kind IN ('text','file')", name="ck_study_material_source"),
    )
    op.create_index("ix_study_material_owner_created", "study_material", ["owner_id", "created_at"])
    op.create_index("ix_study_material_course_id", "study_material", ["course_id"])

    op.create_table(
        "study_question",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("material_id", sa.Integer(), sa.ForeignKey("study_material.id", ondelete="CASCADE"), nullable=False),
        sa.Column("kind", sa.String(5), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("prompt", sa.Text(), nullable=False),
        sa.Column("options", sa.JSON()),
        sa.Column("answer_index", sa.Integer()),
        sa.Column("reference", sa.Text()),
        sa.Column("explanation", sa.Text()),
        sa.CheckConstraint("kind IN ('mcq','short')", name="ck_study_question_kind"),
    )
    op.create_index("ix_study_question_material", "study_question", ["material_id", "position"])

    op.create_table(
        "study_card",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("material_id", sa.Integer(), sa.ForeignKey("study_material.id", ondelete="CASCADE"), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("front", sa.Text(), nullable=False),
        sa.Column("back", sa.Text(), nullable=False),
        sa.Column("right", sa.Integer(), server_default="0", nullable=False),
        sa.Column("wrong", sa.Integer(), server_default="0", nullable=False),
    )
    op.create_index("ix_study_card_material", "study_card", ["material_id", "position"])

    op.create_table(
        "study_attempt",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("material_id", sa.Integer(), sa.ForeignKey("study_material.id", ondelete="CASCADE"), nullable=False),
        sa.Column("owner_id", sa.Integer(), sa.ForeignKey("user.id", ondelete="CASCADE"), nullable=False),
        sa.Column("kind", sa.String(5), nullable=False),
        sa.Column("score", sa.Integer(), nullable=False),
        sa.Column("total", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("kind IN ('quiz','short')", name="ck_study_attempt_kind"),
        sa.CheckConstraint("total >= 1 AND score >= 0 AND score <= total", name="ck_study_attempt_score"),
    )
    op.create_index("ix_study_attempt_material", "study_attempt", ["material_id", "created_at"])


def downgrade() -> None:
    op.drop_table("study_attempt")
    op.drop_table("study_card")
    op.drop_table("study_question")
    op.drop_table("study_material")
