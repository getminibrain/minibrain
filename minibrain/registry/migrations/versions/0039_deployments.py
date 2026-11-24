import sqlalchemy as sa
from alembic import op

revision = "0039"
down_revision = "0038"

TIMESTAMP = sa.DateTime(timezone=True)
AUTOINCREMENT = {"sqlite_autoincrement": True}
MODEL_COLUMNS = ("move_failure", "moving_since", "moving_from", "replicas", "pool", "deployed_base", "deployed")
BASE_COLUMNS = ("move_failure", "moving_since", "moving_from", "replicas", "pool", "deployed")

COPY_MODELS = """
INSERT INTO deployments
    (model_id, base, pool, replicas, moving_from, moving_since, move_failure, created_at, updated_at)
SELECT id, deployed_base, COALESCE(pool, 'local'), replicas, moving_from, moving_since, move_failure,
    CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM models WHERE deployed
"""
COPY_BASES = """
INSERT INTO deployments
    (base_model_id, pool, replicas, moving_from, moving_since, move_failure, created_at, updated_at)
SELECT id, COALESCE(pool, 'local'), replicas, moving_from, moving_since, move_failure,
    CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM base_models WHERE deployed
"""
RESTORE_MODELS = """
UPDATE models SET
    deployed = true,
    deployed_base = (SELECT base FROM deployments WHERE model_id = models.id),
    pool = (SELECT pool FROM deployments WHERE model_id = models.id),
    replicas = (SELECT replicas FROM deployments WHERE model_id = models.id),
    moving_from = (SELECT moving_from FROM deployments WHERE model_id = models.id),
    moving_since = (SELECT moving_since FROM deployments WHERE model_id = models.id),
    move_failure = (SELECT move_failure FROM deployments WHERE model_id = models.id)
WHERE id IN (SELECT model_id FROM deployments)
"""
RESTORE_BASES = """
UPDATE base_models SET
    deployed = true,
    pool = (SELECT pool FROM deployments WHERE base_model_id = base_models.id),
    replicas = (SELECT replicas FROM deployments WHERE base_model_id = base_models.id),
    moving_from = (SELECT moving_from FROM deployments WHERE base_model_id = base_models.id),
    moving_since = (SELECT moving_since FROM deployments WHERE base_model_id = base_models.id),
    move_failure = (SELECT move_failure FROM deployments WHERE base_model_id = base_models.id)
WHERE id IN (SELECT base_model_id FROM deployments)
"""


def upgrade() -> None:
    op.create_table(
        "deployments",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("model_id", sa.Integer(), nullable=True),
        sa.Column("base_model_id", sa.String(), nullable=True),
        sa.Column("base", sa.String(), nullable=True),
        sa.Column("pool", sa.String(), nullable=False),
        sa.Column("replicas", sa.Integer(), nullable=False),
        sa.Column("moving_from", sa.String(), nullable=True),
        sa.Column("moving_since", TIMESTAMP, nullable=True),
        sa.Column("move_failure", sa.String(), nullable=True),
        sa.Column("created_at", TIMESTAMP, nullable=False),
        sa.Column("updated_at", TIMESTAMP, nullable=False),
        sa.CheckConstraint("(model_id IS NULL) <> (base_model_id IS NULL)", name="ck_deployments_one_owner"),
        sa.ForeignKeyConstraint(["model_id"], ["models.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["base_model_id"], ["base_models.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("model_id"),
        sa.UniqueConstraint("base_model_id"),
        sqlite_autoincrement=True,
    )
    op.execute(COPY_MODELS)
    op.execute(COPY_BASES)
    with op.batch_alter_table("models", table_kwargs=AUTOINCREMENT) as batch:
        for column in MODEL_COLUMNS:
            batch.drop_column(column)
    with op.batch_alter_table("base_models") as batch:
        for column in BASE_COLUMNS:
            batch.drop_column(column)


def placement_columns() -> list[sa.Column]:
    return [
        sa.Column("pool", sa.String(), nullable=True),
        sa.Column("replicas", sa.Integer(), server_default="1", nullable=False),
        sa.Column("moving_from", sa.String(), nullable=True),
        sa.Column("moving_since", TIMESTAMP, nullable=True),
        sa.Column("move_failure", sa.String(), nullable=True),
    ]


def downgrade() -> None:
    with op.batch_alter_table("models", table_kwargs=AUTOINCREMENT) as batch:
        batch.add_column(sa.Column("deployed", sa.Boolean(), server_default=sa.false(), nullable=False))
        batch.add_column(sa.Column("deployed_base", sa.String(), nullable=True))
        for column in placement_columns():
            batch.add_column(column)
    with op.batch_alter_table("base_models") as batch:
        batch.add_column(sa.Column("deployed", sa.Boolean(), server_default=sa.false(), nullable=False))
        for column in placement_columns():
            batch.add_column(column)
    op.execute(RESTORE_MODELS)
    op.execute(RESTORE_BASES)
    op.drop_table("deployments")
