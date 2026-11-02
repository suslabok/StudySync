"""search indexes

Revision ID: 815625d8d513
Revises: ea8bffe5017d
Create Date: 2026-11-02 12:15:01.485123

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '815625d8d513'
down_revision: Union[str, Sequence[str], None] = 'ea8bffe5017d'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


_FTS = {
    "ix_task_fts": ("task", "coalesce(title, '') || ' ' || coalesce(notes, '')"),
    "ix_assignment_fts": ("assignment", "coalesce(title, '') || ' ' || coalesce(notes, '')"),
    "ix_post_fts": ("post", "coalesce(body, '')"),
    "ix_comment_fts": ("comment", "coalesce(body, '')"),
}


def upgrade() -> None:
    for name, (table, expr) in _FTS.items():
        op.execute(f"CREATE INDEX {name} ON \"{table}\" USING gin (to_tsvector('english', {expr}))")


def downgrade() -> None:
    for name in _FTS:
        op.execute(f"DROP INDEX IF EXISTS {name}")