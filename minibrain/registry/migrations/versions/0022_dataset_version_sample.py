import sqlalchemy as sa
from alembic import op

revision = "0022"
down_revision = "0021"


def upgrade() -> None:
    with op.batch_alter_table("dataset_versions") as batch:
        batch.add_column(sa.Column("sample", sa.JSON(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("dataset_versions") as batch:
        batch.drop_column("sample")
