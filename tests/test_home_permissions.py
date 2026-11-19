import stat
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pytest
from sqlalchemy import create_engine, text

from minibrain.settings import Settings, load_settings


def mode_of(path: Path) -> int:
    return stat.S_IMODE(path.stat().st_mode)


def test_home_secrets_and_database_are_private(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    home = tmp_path / "home"
    home.mkdir(mode=0o755)
    home.chmod(0o755)
    (home / "secrets").mkdir(mode=0o755)
    (home / "secrets").chmod(0o755)
    for name in ("minibrain.db-wal", "minibrain.db-shm"):
        (home / name).write_bytes(b"")
        (home / name).chmod(0o644)
    monkeypatch.setenv("MINIBRAIN_HOME", str(home))
    monkeypatch.delenv("MINIBRAIN_DATABASE_URL", raising=False)
    settings = load_settings()
    assert mode_of(home) == 0o700 and mode_of(home / "secrets") == 0o700
    for name in ("minibrain.db", "minibrain.db-wal", "minibrain.db-shm"):
        assert mode_of(home / name) == 0o600, name
    (home / "minibrain.db-wal").unlink()
    (home / "minibrain.db-shm").unlink()
    engine = create_engine(settings.database_url)
    with engine.connect() as connection:
        connection.execute(text("PRAGMA journal_mode=WAL"))
        connection.execute(text("CREATE TABLE probe (id INTEGER)"))
        connection.commit()
        assert mode_of(home / "minibrain.db-wal") == 0o600
    engine.dispose()


def test_a_new_secret_is_private_and_the_same_for_every_first_caller(tmp_path: Path) -> None:
    settings = Settings(home=tmp_path / "home", web_dist=tmp_path / "web")
    with ThreadPoolExecutor(16) as pool:
        values = set(pool.map(lambda _: settings.secret("race_token"), range(64)))
    path = settings.home / "secrets" / "race_token"
    assert len(values) == 1 and values == {path.read_text().strip()}
    assert mode_of(path) == 0o600 and mode_of(path.parent) == 0o700
    assert [entry.name for entry in path.parent.iterdir()] == ["race_token"]
