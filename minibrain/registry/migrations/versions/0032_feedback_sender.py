import sqlalchemy as sa
from alembic import op

revision = "0032"
down_revision = "0031"


def upgrade() -> None:
    with op.batch_alter_table("feedback") as batch:
        batch.add_column(sa.Column("sent_by", sa.String(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("feedback") as batch:
        batch.drop_column("sent_by")
