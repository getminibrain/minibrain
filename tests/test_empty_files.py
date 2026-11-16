import pytest

from tests.conftest import Harness, tickets_csv

NO_ROWS = "{name} has no rows: add rows to it, then make the dataset"


def upload(harness: Harness, name: str, data: bytes) -> dict:
    response = harness.client.post("/api/sources", files={"file": (name, data, "text/csv")})
    assert response.status_code == 201, response.text
    return response.json()


@pytest.mark.parametrize(
    ("name", "data"), [("empty.csv", b""), ("blank.jsonl", b"\n  \r\n"), ("bom.tsv", b"\xef\xbb\xbf")]
)
def test_empty_files_are_refused_at_upload(harness: Harness, name: str, data: bytes) -> None:
    refused = harness.client.post("/api/sources", files={"file": (name, data, "text/csv")})
    assert refused.status_code == 422
    assert refused.json()["detail"] == f"{name} is empty: upload a file that has rows of data"
    assert harness.client.get("/api/sources").json() == []


def test_a_header_only_file_is_refused_whatever_columns_are_picked(harness: Harness) -> None:
    head = upload(harness, "head.csv", b"text,category\n")
    other = upload(harness, "other.csv", b"foo,bar\n")
    assert (head["rows"], other["rows"]) == (0, 0)
    bodies = [
        {"source_id": head["id"]},
        {"source_id": head["id"], "input_column": "text"},
        {"source_id": head["id"], "input_column": "text", "label_column": "category"},
        {"source_id": head["id"], "template": {"user": "{text}"}},
        {"source_id": other["id"]},
        {"source_id": other["id"], "input_column": "foo", "label_column": "bar"},
    ]
    for index, body in enumerate(bodies):
        refused = harness.client.post("/api/datasets", json={"name": f"Empty {index}", **body})
        source = head if body["source_id"] == head["id"] else other
        assert refused.status_code == 409, body
        assert refused.json()["detail"] == NO_ROWS.format(name=source["name"])
    assert harness.client.get("/api/datasets").json() == []
    full = upload(harness, "tickets.csv", tickets_csv())
    dataset = harness.client.post("/api/datasets", json={"name": "Tickets", "source_id": full["id"]}).json()
    moved = harness.client.put(
        f"/api/datasets/{dataset['slug']}/mapping",
        json={"source_id": head["id"], "input_column": "text", "label_column": "category"},
    )
    assert moved.status_code == 409 and moved.json()["detail"] == NO_ROWS.format(name="head.csv")


def test_an_empty_json_array_uploads_as_a_source_with_no_rows(harness: Harness) -> None:
    added = upload(harness, "empty.json", b"[]")
    assert added["rows"] == 0
    refused = harness.client.post("/api/datasets", json={"name": "Empty", "source_id": added["id"]})
    assert refused.status_code == 409 and refused.json()["detail"] == NO_ROWS.format(name="empty.json")
