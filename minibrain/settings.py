import contextlib
import os
import secrets
from dataclasses import dataclass
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
DATABASE_FILE = "minibrain.db"
DATABASE_SIDE_FILES = ("-wal", "-shm", "-journal")
PRIVATE_FOLDER = 0o700
PRIVATE_FILE = 0o600
GATEWAY_CONCURRENCY = 64
GATEWAY_CONCURRENCY_ENV = "MINIBRAIN_GATEWAY_CONCURRENCY"


@dataclass(frozen=True)
class Settings:
    home: Path
    web_dist: Path
    database: str | None = None
    ui_url: str | None = None
    gateway_concurrency: int = GATEWAY_CONCURRENCY

    @property
    def database_url(self) -> str:
        return self.database or f"sqlite:///{self.home / DATABASE_FILE}"

    def artifacts_dir(self) -> Path:
        return self.home / "artifacts"

    def cache_dir(self) -> Path:
        return self.home / "cache"

    def work_dir(self) -> Path:
        return self.home / "work"

    def secret(self, name: str) -> str:
        override = os.environ.get(f"MINIBRAIN_{name.upper()}")
        if override:
            return override
        path = self.home / "secrets" / name
        if not path.exists():
            place_once(path, secrets.token_urlsafe(32))
        return path.read_text().strip()


def private_folder(path: Path) -> None:
    path.mkdir(parents=True, exist_ok=True, mode=PRIVATE_FOLDER)
    with contextlib.suppress(PermissionError):
        path.chmod(PRIVATE_FOLDER)


def place_once(path: Path, text: str) -> None:
    private_folder(path.parent)
    draft = path.with_name(f".{path.name}.{secrets.token_hex(8)}")
    descriptor = os.open(draft, os.O_WRONLY | os.O_CREAT | os.O_EXCL, PRIVATE_FILE)
    try:
        with os.fdopen(descriptor, "w") as stream:
            stream.write(text)
            stream.flush()
            os.fsync(stream.fileno())
        with contextlib.suppress(FileExistsError):
            os.link(draft, path)
    finally:
        draft.unlink()


def secure_home(home: Path, database: str | None) -> None:
    private_folder(home)
    if (home / "secrets").is_dir():
        private_folder(home / "secrets")
    if database is not None:
        return
    db = home / DATABASE_FILE
    with contextlib.suppress(FileExistsError):
        os.close(os.open(db, os.O_WRONLY | os.O_CREAT | os.O_EXCL, PRIVATE_FILE))
    for path in (db, *(db.with_name(db.name + suffix) for suffix in DATABASE_SIDE_FILES)):
        if path.exists():
            with contextlib.suppress(PermissionError):
                path.chmod(PRIVATE_FILE)


def demo_file(name: str) -> Path:
    packaged = Path(__file__).resolve().parent / "demo_data" / name
    return packaged if packaged.is_file() else REPO_ROOT / "demo_data" / name


def default_web_dist() -> Path:
    packaged = Path(__file__).resolve().parent / "web"
    return packaged if (packaged / "index.html").is_file() else REPO_ROOT / "web" / "dist"


def gateway_concurrency() -> int:
    raw = os.environ.get(GATEWAY_CONCURRENCY_ENV, "").strip()
    if not raw:
        return GATEWAY_CONCURRENCY
    try:
        found = int(raw)
    except ValueError:
        found = 0
    if found < 1:
        raise ValueError(f"{GATEWAY_CONCURRENCY_ENV} must be a whole number of 1 or more, not {raw}")
    return found


def load_settings() -> Settings:
    home = Path(os.environ.get("MINIBRAIN_HOME", Path.home() / ".minibrain")).expanduser()
    web_dist = Path(os.environ.get("MINIBRAIN_WEB_DIST", default_web_dist()))
    database = os.environ.get("MINIBRAIN_DATABASE_URL") or None
    secure_home(home, database)
    return Settings(
        home=home,
        web_dist=web_dist,
        database=database,
        ui_url=os.environ.get("MINIBRAIN_UI_URL", "").rstrip("/") or None,
        gateway_concurrency=gateway_concurrency(),
    )
