from collections.abc import Iterator
from pathlib import Path

import pytest

from minibrain.data import remote
from minibrain.data.encoding import UTF8, WINDOWS_1252
from tests.conftest import Harness, tickets_csv
from tests.fake_s3 import FakeS3, fake_s3
from tests.test_folders import allow
from tests.test_remote_sources import s3_connection

ROWS = ["café “refund” please", "naïve crème brûlée — bug", "Größe €5 billing"]
LABELS = ["billing", "bug", "billing"]


def windows_1252_csv() -> bytes:
    lines = ["text,category", *(f'"{text}",{label}' for text, label in zip(ROWS, LABELS, strict=True))]
    data = ("\n".join(lines) + "\n").encode("cp1252")
    data.decode("latin-1")
    with pytest.raises(UnicodeDecodeError):
        data.decode("utf-8")
    return data


def texts(harness: Harness, source_id: int) -> list[str]:
    rows = harness.client.get(f"/api/sources/{source_id}/rows").json()["rows"]
    return sorted(row[0] for row in rows)


@pytest.fixture
def bucket() -> Iterator[FakeS3]:
    with fake_s3() as found:
        found.bucket("data")
        yield found


def test_an_upload_that_is_not_utf8_is_read_as_windows_1252(harness: Harness) -> None:
    files = {"file": ("legacy.csv", windows_1252_csv(), "text/csv")}
    response = harness.client.post("/api/sources", files=files)
    assert response.status_code == 201, response.text
    source = response.json()
    assert (source["encoding"], source["rows"], source["error"]) == (WINDOWS_1252, 3, None)
    assert texts(harness, source["id"]) == sorted(ROWS)
    plain = harness.client.post("/api/sources", files={"file": ("plain.csv", tickets_csv(), "text/csv")}).json()
    assert plain["encoding"] == UTF8
    dataset = harness.client.post("/api/datasets", json={"name": "Legacy", "source_id": source["id"]}).json()
    preview = harness.client.get(f"/api/datasets/{dataset['slug']}/preview").json()
    assert sorted(row["input"] for row in preview["rows"]) == sorted(ROWS)


def test_a_folder_of_windows_1252_files_is_read_and_says_so(harness: Harness, tmp_path: Path) -> None:
    root = tmp_path / "legacy"
    root.mkdir()
    (root / "old.csv").write_bytes(windows_1252_csv())
    (root / "new.csv").write_bytes(tickets_csv(4))
    allow(harness, root)
    response = harness.client.post("/api/sources/folders", json={"path": str(root)})
    assert response.status_code == 201, response.text
    source = response.json()
    assert (source["encoding"], source["rows"], source["error"]) == (WINDOWS_1252, 7, None)
    assert set(ROWS) <= set(texts(harness, source["id"]))
    (root / "old.csv").write_bytes(tickets_csv(2))
    again = harness.client.get(f"/api/sources/{source['id']}").json()
    assert (again["encoding"], again["rows"]) == (UTF8, 6)


def test_an_s3_csv_that_is_not_utf8_is_read_as_windows_1252(harness: Harness, bucket: FakeS3) -> None:
    bucket.put("data", "legacy/old.csv", windows_1252_csv())
    connection = s3_connection(harness, bucket)
    response = harness.client.post(
        "/api/sources/s3", json={"connection_id": connection["id"], "path": "s3://data/legacy/"}
    )
    assert response.status_code == 201, response.text
    source = response.json()
    assert (source["encoding"], source["rows"], source["error"]) == (WINDOWS_1252, 3, None)
    assert texts(harness, source["id"]) == sorted(ROWS)
    remote.STATES.clear()
    assert harness.client.get(f"/api/sources/{source['id']}").json()["rows"] == 3
