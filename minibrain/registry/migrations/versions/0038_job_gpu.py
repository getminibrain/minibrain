from typing import Any

import sqlalchemy as sa
from alembic import op

revision = "0038"
down_revision = "0037"


def keep() -> dict[str, Any]:
    if op.get_bind().dialect.name == "sqlite":
        return {"recreate": "always", "table_kwargs": {"sqlite_autoincrement": True}}
    return {}


def upgrade() -> None:
    with op.batch_alter_table("jobs", **keep()) as batch:
        batch.add_column(sa.Column("gpu", sa.JSON(), nullable=True))
        batch.add_column(sa.Column("waiting", sa.String(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("jobs", **keep()) as batch:
        batch.drop_column("waiting")
        batch.drop_column("gpu")
