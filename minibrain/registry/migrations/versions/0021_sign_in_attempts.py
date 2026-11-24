from typing import Any

import sqlalchemy as sa
from alembic import op

revision = "0021"
down_revision = "0020"

TIMESTAMP = sa.DateTime(timezone=True)


def keep() -> dict[str, Any]:
    if op.get_bind().dialect.name == "sqlite":
        return {"recreate": "always", "table_kwargs": {"sqlite_autoincrement": True}}
    return {}


def upgrade() -> None:
    op.create_table(
        "sign_in_attempts",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("address", sa.String(), nullable=False),
        sa.Column("email", sa.String(), nullable=False),
        sa.Column("failed", sa.Boolean(), nullable=False),
        sa.Column("at", TIMESTAMP, nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sqlite_autoincrement=True,
    )
    op.create_index("ix_sign_in_attempts_address", "sign_in_attempts", ["address", "at"])
    op.create_index("ix_sign_in_attempts_email", "sign_in_attempts", ["email", "at"])
    with op.batch_alter_table("users", **keep()) as batch:
        batch.drop_column("locked_until")
        batch.drop_column("failed_sign_ins")


def downgrade() -> None:
    with op.batch_alter_table("users", **keep()) as batch:
        batch.add_column(sa.Column("failed_sign_ins", sa.Integer(), nullable=False, server_default="0"))
        batch.add_column(sa.Column("locked_until", TIMESTAMP, nullable=True))
    op.drop_index("ix_sign_in_attempts_email", table_name="sign_in_attempts")
    op.drop_index("ix_sign_in_attempts_address", table_name="sign_in_attempts")
    op.drop_table("sign_in_attempts")
