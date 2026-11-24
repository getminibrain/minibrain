import sqlalchemy as sa
from alembic import op

revision = "0038"
down_revision = "0037"

KEEP = {"recreate": "always", "table_kwargs": {"sqlite_autoincrement": True}}


def upgrade() -> None:
    with op.batch_alter_table("jobs", **KEEP) as batch:
        batch.add_column(sa.Column("gpu", sa.JSON(), nullable=True))
        batch.add_column(sa.Column("waiting", sa.String(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("jobs", **KEEP) as batch:
        batch.drop_column("waiting")
        batch.drop_column("gpu")
