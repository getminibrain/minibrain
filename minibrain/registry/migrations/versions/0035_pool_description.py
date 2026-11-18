import sqlalchemy as sa
from alembic import op

revision = "0035"
down_revision = "0034"


def upgrade() -> None:
    with op.batch_alter_table("pool_settings") as batch:
        batch.add_column(sa.Column("description", sa.String(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("pool_settings") as batch:
        batch.drop_column("description")
