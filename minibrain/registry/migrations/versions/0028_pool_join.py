import sqlalchemy as sa
from alembic import op

revision = "0028"
down_revision = "0027"

TIMESTAMP = sa.DateTime(timezone=True)
LIVE = sa.text("revoked_at IS NULL")
OLDER_LIVE = sa.text(
    "UPDATE join_tokens SET revoked_at = created_at WHERE revoked_at IS NULL AND id NOT IN "
    "(SELECT MAX(id) FROM join_tokens WHERE revoked_at IS NULL GROUP BY pool)"
)


def upgrade() -> None:
    op.execute(OLDER_LIVE)
    with op.batch_alter_table("join_tokens", table_kwargs={"sqlite_autoincrement": True}) as batch:
        batch.drop_column("role")
        batch.drop_column("expires_at")
    op.create_index(
        "uq_join_tokens_live_pool",
        "join_tokens",
        ["pool"],
        unique=True,
        sqlite_where=LIVE,
        postgresql_where=LIVE,
    )
    op.create_table(
        "join_requests",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("code", sa.String(), nullable=False),
        sa.Column("digest", sa.String(), nullable=False),
        sa.Column("host", sa.String(), nullable=False),
        sa.Column("hardware", sa.JSON(), nullable=False),
        sa.Column("asked_pool", sa.String(), nullable=True),
        sa.Column("address", sa.String(), nullable=True),
        sa.Column("state", sa.String(), nullable=False),
        sa.Column("created_at", TIMESTAMP, nullable=False),
        sa.Column("expires_at", TIMESTAMP, nullable=False),
        sa.Column("pool", sa.String(), nullable=True),
        sa.Column("decided_by", sa.String(), nullable=True),
        sa.Column("decided_at", TIMESTAMP, nullable=True),
        sa.Column("credential_digest", sa.String(), nullable=True),
        sa.Column("collected_at", TIMESTAMP, nullable=True),
        sa.Column("last_used_at", TIMESTAMP, nullable=True),
        sa.Column("revoked_at", TIMESTAMP, nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("digest"),
        sa.UniqueConstraint("credential_digest"),
        sqlite_autoincrement=True,
    )
    op.create_index("ix_join_requests_state", "join_requests", ["state"])


def downgrade() -> None:
    op.drop_index("ix_join_requests_state", table_name="join_requests")
    op.drop_table("join_requests")
    op.drop_index("uq_join_tokens_live_pool", table_name="join_tokens")
    with op.batch_alter_table("join_tokens", table_kwargs={"sqlite_autoincrement": True}) as batch:
        batch.add_column(sa.Column("role", sa.String(), nullable=False, server_default="both"))
        batch.add_column(sa.Column("expires_at", TIMESTAMP, nullable=True))
