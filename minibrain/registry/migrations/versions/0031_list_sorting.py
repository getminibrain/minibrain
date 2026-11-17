import sqlalchemy as sa
from alembic import op

revision = "0031"
down_revision = "0030"


def upgrade() -> None:
    with op.batch_alter_table("versions") as batch:
        batch.add_column(sa.Column("score", sa.Double(), nullable=True))
    op.create_index("ix_request_logs_latency", "request_logs", ["latency_ms", "id"])
    op.create_index("ix_request_logs_status", "request_logs", ["status", "id"])


def downgrade() -> None:
    op.drop_index("ix_request_logs_status", table_name="request_logs")
    op.drop_index("ix_request_logs_latency", table_name="request_logs")
    with op.batch_alter_table("versions") as batch:
        batch.drop_column("score")
