import sqlalchemy as sa
from alembic import op

revision = "0029"
down_revision = "0028"


def upgrade() -> None:
    with op.batch_alter_table("versions") as batch:
        batch.add_column(sa.Column("note", sa.String(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("versions") as batch:
        batch.drop_column("note")
