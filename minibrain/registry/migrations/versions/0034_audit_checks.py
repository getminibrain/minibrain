import sqlalchemy as sa
from alembic import op

revision = "0034"
down_revision = "0033"

TIMESTAMP = sa.DateTime(timezone=True)
COLUMNS = (
    ("verified_seq", sa.BigInteger()),
    ("verified_hash", sa.String()),
    ("verified_at", TIMESTAMP),
    ("full_checked_at", TIMESTAMP),
    ("broken_seq", sa.BigInteger()),
    ("broken_reason", sa.String()),
    ("broken_at", TIMESTAMP),
)


def upgrade() -> None:
    with op.batch_alter_table("audit_chain") as batch:
        for name, kind in COLUMNS:
            batch.add_column(sa.Column(name, kind, nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("audit_chain") as batch:
        for name, _ in reversed(COLUMNS):
            batch.drop_column(name)
