import sqlalchemy as sa
from alembic import op

revision = "0037"
down_revision = "0036"

TABLE = "audit_chain_breaks"
FOUND = "uq_audit_chain_breaks_found"
NAMING = {"uq": "uq_%(table_name)s_%(column_0_name)s"}
KEEP = {"table_kwargs": {"sqlite_autoincrement": True}, "naming_convention": NAMING}


OLD = {"sqlite": "uq_audit_chain_breaks_seq", "postgresql": "audit_chain_breaks_seq_reason_key"}


def old_unique() -> str:
    return OLD[op.get_bind().dialect.name]


def upgrade() -> None:
    with op.batch_alter_table(TABLE, **KEEP) as batch:
        batch.add_column(sa.Column("fingerprint", sa.String(), nullable=False, server_default=sa.text("''")))
        batch.drop_constraint(old_unique(), type_="unique")
        batch.create_unique_constraint(FOUND, ["seq", "reason", "fingerprint"])


def downgrade() -> None:
    with op.batch_alter_table(TABLE, **KEEP) as batch:
        batch.drop_constraint(FOUND, type_="unique")
        batch.drop_column("fingerprint")
        batch.create_unique_constraint(old_unique(), ["seq", "reason"])
