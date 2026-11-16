import sqlalchemy as sa
from alembic import op

revision = "0024"
down_revision = "0023"


def upgrade() -> None:
    with op.batch_alter_table("versions") as batch:
        batch.add_column(sa.Column("device_time", sa.JSON(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("versions") as batch:
        batch.drop_column("device_time")
