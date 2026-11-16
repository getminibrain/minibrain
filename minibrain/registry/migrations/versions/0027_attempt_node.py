import sqlalchemy as sa
from alembic import op

revision = "0027"
down_revision = "0026"


def upgrade() -> None:
    with op.batch_alter_table("job_attempts") as batch:
        batch.add_column(sa.Column("node_id", sa.String(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("job_attempts") as batch:
        batch.drop_column("node_id")
