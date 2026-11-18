import sqlalchemy as sa
from alembic import op

revision = "0036"
down_revision = "0035"

TIMESTAMP = sa.DateTime(timezone=True)
HEAD_MARKS = (
    ("broken_seq", sa.BigInteger()),
    ("broken_reason", sa.String()),
    ("broken_at", TIMESTAMP),
)


def upgrade() -> None:
    op.create_table(
        "audit_chain_breaks",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("seq", sa.BigInteger(), nullable=False),
        sa.Column("event_id", sa.Integer(), nullable=True),
        sa.Column("reason", sa.String(), nullable=False),
        sa.Column("found_by", sa.String(), nullable=False),
        sa.Column("found_at", TIMESTAMP, nullable=False),
        sa.Column("acknowledged_at", TIMESTAMP, nullable=True),
        sa.Column("acknowledged_by", sa.String(), nullable=True),
        sa.Column("note", sa.String(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("seq", "reason"),
        sqlite_autoincrement=True,
    )
    with op.batch_alter_table("audit_chain") as batch:
        for name, _ in reversed(HEAD_MARKS):
            batch.drop_column(name)


def downgrade() -> None:
    with op.batch_alter_table("audit_chain") as batch:
        for name, kind in HEAD_MARKS:
            batch.add_column(sa.Column(name, kind, nullable=True))
    op.drop_table("audit_chain_breaks")
