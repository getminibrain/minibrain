from typing import Any

import sqlalchemy as sa
from alembic import op

revision = "0008"
down_revision = "0007"


def link(target: str, column: str, ondelete: str) -> sa.Column:
    return sa.Column(column, sa.Integer(), sa.ForeignKey(target, ondelete=ondelete), nullable=True)


JOB_LINKS = {"model_id": "models.id", "version_id": "versions.id"}
LOG_LINKS = {"model_id": "models.id"}
KEEP = {"recreate": "always", "table_kwargs": {"sqlite_autoincrement": True}}


def on_sqlite() -> bool:
    return op.get_bind().dialect.name == "sqlite"


def sqlite_rebuild(links: dict[str, str], ondelete: str) -> dict[str, Any]:
    if not on_sqlite():
        return {}
    return {"reflect_args": tuple(link(target, column, ondelete) for column, target in links.items()), **KEEP}


def swap_foreign_keys(table: str, links: dict[str, str], ondelete: str) -> None:
    for column, target in links.items():
        name = f"{table}_{column}_fkey"
        referent, referred = target.split(".")
        op.drop_constraint(name, table, type_="foreignkey")
        op.create_foreign_key(name, table, referent, [column], [referred], ondelete=ondelete)


def relink(ondelete: str) -> None:
    if not on_sqlite():
        swap_foreign_keys("jobs", JOB_LINKS, ondelete)
        swap_foreign_keys("request_logs", LOG_LINKS, ondelete)
    with op.batch_alter_table("jobs", **sqlite_rebuild(JOB_LINKS, ondelete)) as batch:
        if ondelete == "SET NULL":
            batch.add_column(sa.Column("model_slug", sa.String(), nullable=True))
            batch.add_column(sa.Column("model_name", sa.String(), nullable=True))
            batch.add_column(sa.Column("version_number", sa.Integer(), nullable=True))
            batch.add_column(sa.Column("base_model_key", sa.String(), nullable=True))
        else:
            batch.drop_column("base_model_key")
            batch.drop_column("version_number")
            batch.drop_column("model_name")
            batch.drop_column("model_slug")
    with op.batch_alter_table("request_logs", **sqlite_rebuild(LOG_LINKS, ondelete)) as batch:
        if ondelete == "SET NULL":
            batch.add_column(sa.Column("model_slug", sa.String(), nullable=True))
            batch.add_column(sa.Column("model_name", sa.String(), nullable=True))
        else:
            batch.drop_column("model_name")
            batch.drop_column("model_slug")


BACKFILL = (
    "UPDATE jobs SET model_slug = (SELECT slug FROM models WHERE models.id = jobs.model_id), "
    "model_name = (SELECT name FROM models WHERE models.id = jobs.model_id) WHERE model_id IS NOT NULL",
    "UPDATE jobs SET version_number = (SELECT number FROM versions WHERE versions.id = jobs.version_id) "
    "WHERE version_id IS NOT NULL",
    "UPDATE jobs SET base_model_key = base_model_id WHERE base_model_id IS NOT NULL",
    "UPDATE request_logs SET model_slug = (SELECT slug FROM models WHERE models.id = request_logs.model_id), "
    "model_name = (SELECT name FROM models WHERE models.id = request_logs.model_id) WHERE model_id IS NOT NULL",
)


def upgrade() -> None:
    relink("SET NULL")
    op.create_index("ix_request_logs_slug", "request_logs", ["model_slug", "id"])
    for statement in BACKFILL:
        op.execute(statement)


def downgrade() -> None:
    op.execute("DELETE FROM jobs WHERE model_id IS NULL AND model_slug IS NOT NULL")
    op.execute("DELETE FROM request_logs WHERE model_id IS NULL AND model_slug IS NOT NULL")
    op.drop_index("ix_request_logs_slug", table_name="request_logs")
    relink("CASCADE")
