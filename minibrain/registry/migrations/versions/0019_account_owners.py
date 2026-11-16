import sqlalchemy as sa
from alembic import op

revision = "0019"
down_revision = "0018"

OWNER = "fk_api_keys_created_by_id"
KEEP = {"recreate": "always", "table_kwargs": {"sqlite_autoincrement": True}}


def upgrade() -> None:
    with op.batch_alter_table("api_keys", **KEEP) as batch:
        batch.add_column(sa.Column("created_by_id", sa.Integer(), nullable=True))
        batch.create_foreign_key(OWNER, "users", ["created_by_id"], ["id"], ondelete="SET NULL")
    with op.batch_alter_table("audit_events", **KEEP) as batch:
        batch.add_column(sa.Column("actor_id", sa.Integer(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("audit_events", **KEEP) as batch:
        batch.drop_column("actor_id")
    with op.batch_alter_table("api_keys", **KEEP) as batch:
        batch.drop_constraint(OWNER, type_="foreignkey")
        batch.drop_column("created_by_id")
