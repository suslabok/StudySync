"""course meeting

Revision ID: 4991f7e118d5
Revises: e93591e0561b
Create Date: 2026-11-05 07:58:56.716659

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '4991f7e118d5'
down_revision: Union[str, Sequence[str], None] = 'e93591e0561b'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

def upgrade() -> None:
    op.create_table(
        "course_meeting",
        sa.Column("course_id", sa.Integer(), sa.ForeignKey("course.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("url", sa.String(200), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("course_meeting")
