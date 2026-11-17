import sqlalchemy as sa
from alembic import op

revision = "0030"
down_revision = "0029"

TIMESTAMP = sa.DateTime(timezone=True)


def upgrade() -> None:
    op.create_table(
        "version_exports",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("version_id", sa.Integer(), nullable=False),
        sa.Column("format", sa.String(), nullable=False),
        sa.Column("base_hash", sa.String(), nullable=False),
        sa.Column("job_id", sa.Integer(), nullable=True),
        sa.Column("artifact_id", sa.String(), nullable=True),
        sa.Column("files", sa.JSON(), nullable=False),
        sa.Column("requested_by", sa.String(), nullable=False),
        sa.Column("created_at", TIMESTAMP, nullable=False),
        sa.Column("finished_at", TIMESTAMP, nullable=True),
        sa.ForeignKeyConstraint(["version_id"], ["versions.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["job_id"], ["jobs.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["artifact_id"], ["artifacts.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("version_id", "format", "base_hash"),
        sqlite_autoincrement=True,
    )


def downgrade() -> None:
    op.drop_table("version_exports")
