from typing import Any

import sqlalchemy as sa
from alembic import op

revision = "0019"
down_revision = "0018"

OWNER = "fk_api_keys_created_by_id"


def keep() -> dict[str, Any]:
    if op.get_bind().dialect.name == "sqlite":
        return {"recreate": "always", "table_kwargs": {"sqlite_autoincrement": True}}
    return {}


def upgrade() -> None:
    with op.batch_alter_table("api_keys", **keep()) as batch:
        batch.add_column(sa.Column("created_by_id", sa.Integer(), nullable=True))
        batch.create_foreign_key(OWNER, "users", ["created_by_id"], ["id"], ondelete="SET NULL")
    with op.batch_alter_table("audit_events", **keep()) as batch:
        batch.add_column(sa.Column("actor_id", sa.Integer(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("audit_events", **keep()) as batch:
        batch.drop_column("actor_id")
    with op.batch_alter_table("api_keys", **keep()) as batch:
        batch.drop_constraint(OWNER, type_="foreignkey")
        batch.drop_column("created_by_id")
