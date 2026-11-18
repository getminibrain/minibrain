import sqlalchemy as sa
from alembic import op

revision = "0033"
down_revision = "0032"


def upgrade() -> None:
    op.create_table(
        "pool_settings",
        sa.Column("pool", sa.String(), nullable=False),
        sa.Column("workloads", sa.JSON(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_by", sa.String(), nullable=False),
        sa.PrimaryKeyConstraint("pool"),
    )


def downgrade() -> None:
    op.drop_table("pool_settings")
