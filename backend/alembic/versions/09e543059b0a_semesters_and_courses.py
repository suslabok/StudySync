"""semesters and courses

Revision ID: 09e543059b0a
Revises: cc05d627c9a0
Create Date: 2026-10-15 13:27:20.758440

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '09e543059b0a'
down_revision: Union[str, Sequence[str], None] = 'cc05d627c9a0'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

def upgrade() -> None:
    op.drop_constraint("ck_task_priority", "task", type_="check")
    op.drop_constraint("ck_assignment_priority", "assignment", type_="check")
    op.drop_column("task", "priority")
    op.drop_column("assignment", "priority")


def downgrade() -> None:
    op.add_column("assignment", sa.Column("priority", sa.SmallInteger(), nullable=False, server_default=sa.text("2")))
    op.add_column("task", sa.Column("priority", sa.SmallInteger(), nullable=False, server_default=sa.text("2")))
    op.create_check_constraint("ck_assignment_priority", "assignment", "priority BETWEEN 1 AND 3")
    op.create_check_constraint("ck_task_priority", "task", "priority BETWEEN 1 AND 3")
