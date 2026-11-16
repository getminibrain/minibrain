import sqlalchemy as sa
from alembic import op

revision = "0020"
down_revision = "0019"


def upgrade() -> None:
    with op.batch_alter_table("sources") as batch:
        batch.add_column(sa.Column("encoding", sa.String(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("sources") as batch:
        batch.drop_column("encoding")
