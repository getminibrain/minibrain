import hashlib
import itertools
import json
import re
import shutil
import subprocess
from pathlib import Path

import pytest

from minibrain.data.checks import CHARS_PER_TOKEN
from minibrain.data.cleanup import cleaned_sql

ROOT = Path(__file__).resolve().parent.parent
FIXTURE = ROOT / "tests" / "fixtures" / "cleanup_sql.json"
SCRIPT = ROOT / "web" / "scripts" / "check-cleanup.ts"
BASE_SQL = "SELECT 'it''s' AS input, label FROM \"t\" -- the base query"
OPTIONS: dict[str, list[str | int | None]] = {
    "personal_data": [None, "mask", "drop"],
    "max_tokens": [None, 1, 2048, 1_000_000],
    "conflicts": [None, "common", "drop"],
    "rare": [None, 2, 100_000],
    "per_label": [None, 1, 50_000_000],
}


def combinations() -> list[dict[str, str | int | None]]:
    return [dict(zip(OPTIONS, values, strict=True)) for values in itertools.product(*OPTIONS.values())]


def python_sql(cleanup: dict[str, str | int | None]) -> str:
    return cleaned_sql(BASE_SQL, {key: str(value) for key, value in cleanup.items() if value is not None})


def digest(sql: str) -> str:
    return hashlib.sha256(sql.encode()).hexdigest()


def cases() -> list[dict[str, object]]:
    return [{"cleanup": cleanup, "sha256": digest(python_sql(cleanup))} for cleanup in combinations()]


def fixture() -> dict[str, object]:
    return {"sql": BASE_SQL, "chars_per_token": CHARS_PER_TOKEN, "cases": cases()}


def test_the_python_builder_matches_the_shared_fixture() -> None:
    saved = json.loads(FIXTURE.read_text())
    assert len(saved["cases"]) == 324
    assert saved == fixture(), "run uv run python -m tests.test_cleanup_parity to refresh the fixture"


def node_major() -> int:
    node = shutil.which("node")
    if node is None:
        return 0
    found = re.match(r"v(\d+)", subprocess.run([node, "--version"], capture_output=True, text=True).stdout)
    return int(found.group(1)) if found else 0


@pytest.mark.skipif(node_major() < 22, reason="needs Node 22 or later to run TypeScript")
def test_the_typescript_builder_matches_the_shared_fixture() -> None:
    command = ["node", "--no-warnings", "--experimental-strip-types", str(SCRIPT)]
    ran = subprocess.run(command, capture_output=True, text=True, cwd=ROOT / "web")
    assert ran.returncode == 0, ran.stdout + ran.stderr


def fixture_text() -> str:
    head = json.dumps({"sql": BASE_SQL, "chars_per_token": CHARS_PER_TOKEN})[:-1]
    listed = ",\n".join(f"  {json.dumps(case)}" for case in cases())
    return f'{head}, "cases": [\n{listed}\n]}}\n'


if __name__ == "__main__":
    FIXTURE.write_text(fixture_text())
