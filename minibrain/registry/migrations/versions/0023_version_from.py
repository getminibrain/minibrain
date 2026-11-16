import sqlalchemy as sa
from alembic import op

revision = "0023"
down_revision = "0022"


def upgrade() -> None:
    with op.batch_alter_table("versions") as batch:
        batch.add_column(sa.Column("from_version", sa.Integer(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("versions") as batch:
        batch.drop_column("from_version")
