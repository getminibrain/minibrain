import sqlalchemy as sa
from alembic import op

revision = "0026"
down_revision = "0025"


def upgrade() -> None:
    with op.batch_alter_table("nodes") as batch:
        batch.add_column(sa.Column("state", sa.String(), nullable=False, server_default="active"))


def downgrade() -> None:
    with op.batch_alter_table("nodes") as batch:
        batch.drop_column("state")
