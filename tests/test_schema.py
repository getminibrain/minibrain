import re
import uuid
from collections.abc import Callable, Iterator
from pathlib import Path
from typing import Any

import pytest
from alembic import command
from alembic.autogenerate import compare_metadata
from alembic.config import Config
from alembic.migration import MigrationContext
from sqlalchemy import Engine, create_engine, inspect, text

from minibrain.registry.audit_chain import GENESIS, HEAD
from minibrain.registry.db import MIGRATIONS, make_engine, migrate
from minibrain.registry.models import Base
from tests.test_leader import POSTGRES, needs_postgres

MASTER = "SELECT type, name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND name != 'alembic_version'"
CONSTRAINTS = ("PRIMARY KEY", "FOREIGN KEY", "UNIQUE", "CONSTRAINT", "CHECK")
Shape = tuple[str, tuple[str, ...], tuple[str, ...]]


def migrated(tmp_path: Path) -> Engine:
    url = f"sqlite:///{tmp_path / 'migrated.db'}"
    migrate(url)
    return create_engine(url)


def built(tmp_path: Path) -> Engine:
    engine = create_engine(f"sqlite:///{tmp_path / 'built.db'}")
    Base.metadata.create_all(engine)
    return engine


def parts(body: str) -> list[str]:
    found, depth, current = [], 0, ""
    for char in body:
        depth += {"(": 1, ")": -1}.get(char, 0)
        if char == "," and depth == 0:
            found.append(current.strip())
            current = ""
        else:
            current += char
    return [*found, current.strip()]


def shape(sql: str) -> Shape:
    flat = re.sub(r"\s+", " ", sql).strip()
    head, _, rest = flat.partition("(")
    if not head.startswith("CREATE TABLE"):
        return flat, (), ()
    head = head.replace('"', "")
    items = parts(rest.rsplit(")", 1)[0])
    columns = tuple(item for item in items if not item.startswith(CONSTRAINTS))
    constraints = tuple(sorted(item for item in items if item.startswith(CONSTRAINTS)))
    return head.strip(), columns, constraints


def statements(engine: Engine) -> dict[tuple[str, str], Shape]:
    with engine.connect() as connection:
        rows = connection.execute(text(MASTER)).all()
    return {(kind, name): shape(sql or "") for kind, name, sql in rows}


def test_the_baseline_builds_the_orm_schema(tmp_path: Path) -> None:
    engine = migrated(tmp_path)
    with engine.connect() as connection:
        context = MigrationContext.configure(connection, opts={"compare_type": True, "compare_server_default": True})
        assert compare_metadata(context, Base.metadata) == []
    assert statements(engine) == statements(built(tmp_path))


def test_the_baseline_seeds_the_audit_chain_head(tmp_path: Path) -> None:
    with migrated(tmp_path).connect() as connection:
        head = connection.execute(text("SELECT id, seq, hash, forwarded_seq FROM audit_chain")).all()
    assert head == [(HEAD, 0, GENESIS, 0)]


@pytest.fixture
def postgres_database() -> Iterator[Callable[[], str]]:
    assert POSTGRES is not None
    admin = create_engine(POSTGRES, isolation_level="AUTOCOMMIT")
    server = POSTGRES.rsplit("/", 1)[0]
    names: list[str] = []

    def create() -> str:
        names.append(f"minibrain_{uuid.uuid4().hex[:8]}")
        with admin.connect() as connection:
            connection.execute(text(f'create database "{names[-1]}"'))
        return f"{server}/{names[-1]}"

    yield create
    with admin.connect() as connection:
        for name in names:
            connection.execute(text(f'drop database "{name}" with (force)'))
    admin.dispose()


def foreign_key(item: Any) -> tuple[Any, ...]:
    options = sorted(item["options"].items())
    return item["name"], item["constrained_columns"], item["referred_table"], item["referred_columns"], options


def index(item: Any) -> tuple[Any, ...]:
    return item["name"], item["column_names"], item["unique"], sorted(item.get("dialect_options", {}).items())


def described(url: str) -> dict[str, dict[str, Any]]:
    engine = create_engine(url)
    found = inspect(engine)
    tables = {
        table: {
            "columns": {
                item["name"]: (str(item["type"]), item["nullable"], item["default"])
                for item in found.get_columns(table)
            },
            "primary key": found.get_pk_constraint(table),
            "foreign keys": sorted(foreign_key(item) for item in found.get_foreign_keys(table)),
            "indexes": sorted(index(item) for item in found.get_indexes(table)),
            "uniques": sorted((item["name"], item["column_names"]) for item in found.get_unique_constraints(table)),
            "checks": sorted((item["name"], item["sqltext"]) for item in found.get_check_constraints(table)),
        }
        for table in found.get_table_names()
        if table != "alembic_version"
    }
    engine.dispose()
    return tables


def built_on_postgres(url: str) -> str:
    engine = create_engine(url)
    Base.metadata.create_all(engine)
    engine.dispose()
    return url


def matches_the_orm(migrated: str, built: str) -> None:
    engine = create_engine(migrated)
    with engine.connect() as connection:
        context = MigrationContext.configure(connection, opts={"compare_type": True, "compare_server_default": True})
        assert compare_metadata(context, Base.metadata) == []
    engine.dispose()
    assert described(migrated) == described(built)


@needs_postgres
def test_the_migrations_build_the_orm_schema_on_postgres(postgres_database: Callable[[], str]) -> None:
    migrated = postgres_database()
    migrate(migrated)
    matches_the_orm(migrated, built_on_postgres(postgres_database()))


@needs_postgres
def test_every_migration_downgrades_and_upgrades_again_on_postgres(postgres_database: Callable[[], str]) -> None:
    url = postgres_database()
    engine = make_engine(url)
    config = Config()
    config.set_main_option("script_location", str(MIGRATIONS))
    config.attributes["engine"] = engine
    command.upgrade(config, "head")
    command.downgrade(config, "base")
    assert inspect(engine).get_table_names() == ["alembic_version"]
    command.upgrade(config, "head")
    engine.dispose()
    matches_the_orm(url, built_on_postgres(postgres_database()))
