"""recolor_courses

Revision ID: 80504454e1ea
Revises: 111288737d83
Create Date: 2026-10-30 09:06:26.906789

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '80504454e1ea'
down_revision: Union[str, Sequence[str], None] = '111288737d83'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    MAP = {"#2563eb": "#4b3f5f", "#7c3aed": "#6f58a0", "#db2777": "#b84a72", "#dc2626": "#d14d45",
           "#ea580c": "#c4622d", "#ca8a04": "#a8741a", "#16a34a": "#5f8a45", "#0891b2": "#2a8579"}
    for old, new in MAP.items():
        op.execute(f"UPDATE course SET color = '{new}' WHERE lower(color) = '{old}'")


def downgrade() -> None:
    pass
