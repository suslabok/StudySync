"""remove priority

Revision ID: 09e52ba99692
Revises: 815625d8d513
Create Date: 2026-11-02 12:59:27.402349

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '09e52ba99692'
down_revision: Union[str, Sequence[str], None] = '815625d8d513'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    pass


def downgrade() -> None:
    """Downgrade schema."""
    pass
