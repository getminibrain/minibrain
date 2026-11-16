import sqlalchemy as sa
from alembic import op

revision = "0025"
down_revision = "0024"

TIMESTAMP = sa.DateTime(timezone=True)


def upgrade() -> None:
    op.create_table(
        "join_tokens",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("pool", sa.String(), nullable=False),
        sa.Column("role", sa.String(), nullable=False),
        sa.Column("prefix", sa.String(), nullable=False),
        sa.Column("digest", sa.String(), nullable=False),
        sa.Column("created_at", TIMESTAMP, nullable=False),
        sa.Column("created_by", sa.String(), nullable=False),
        sa.Column("expires_at", TIMESTAMP, nullable=True),
        sa.Column("revoked_at", TIMESTAMP, nullable=True),
        sa.Column("last_used_at", TIMESTAMP, nullable=True),
        sa.Column("last_host", sa.String(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("digest"),
        sqlite_autoincrement=True,
    )
    op.create_index("ix_join_tokens_pool", "join_tokens", ["pool"])


def downgrade() -> None:
    op.drop_index("ix_join_tokens_pool", table_name="join_tokens")
    op.drop_table("join_tokens")
