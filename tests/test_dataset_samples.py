from typing import Any

import duckdb
from sqlalchemy import select

from minibrain.registry.files import store_for
from minibrain.registry.models import AuditEvent
from tests.conftest import Harness, tickets_csv

LIMIT = 1_000
TOTAL = 5_000


def big_dataset(harness: Harness, rows: int = TOTAL, name: str = "tickets.csv") -> dict[str, Any]:
    response = harness.client.post("/api/sources", files={"file": (name, tickets_csv(rows), "text/csv")})
    assert response.status_code == 201, response.text
    assert harness.client.put("/api/settings/data", json={"row_limit": LIMIT}).status_code == 200
    return response.json()


def created(harness: Harness, source: dict[str, Any], name: str, sample: dict[str, int] | None = None) -> Any:
    body: dict[str, Any] = {"name": name, "source_id": source["id"]} | ({"sample": sample} if sample else {})
    return harness.client.post("/api/datasets", json=body)


def inputs(harness: Harness, version: dict[str, Any]) -> list[str]:
    path = store_for(harness.settings).materialize(version["hash"], "file", "dataset_version.parquet")
    with duckdb.connect() as connection:
        return [row[0] for row in connection.execute("SELECT input FROM read_parquet(?)", [str(path)]).fetchall()]


def test_the_refusal_over_the_limit_carries_the_counts(harness: Harness) -> None:
    source = big_dataset(harness)
    refused = created(harness, source, "Tickets")
    assert refused.status_code == 409
    body = refused.json()
    assert (body["total_rows"], body["row_limit"]) == (TOTAL, LIMIT)
    assert "returns 5,000 rows; the limit is 1,000" in body["detail"]
    assert harness.client.get("/api/datasets/tickets").status_code == 404


def test_a_sample_holds_exactly_n_rows_and_is_reproducible_with_its_seed(harness: Harness) -> None:
    source = big_dataset(harness)
    made = created(harness, source, "Tickets", {"rows": 800, "seed": 7})
    assert made.status_code == 201, made.text
    first = made.json()["dataset_version"]
    assert (first["rows"], first["sample"]) == (800, {"rows": 800, "seed": 7, "total": TOTAL})
    assert len(set(inputs(harness, first))) == 800
    again = harness.client.post("/api/datasets/tickets/versions", json={"sample": {"rows": 800, "seed": 7}})
    assert again.status_code == 201, again.text
    assert (again.json()["number"], again.json()["hash"]) == (1, first["hash"])
    other = harness.client.post("/api/datasets/tickets/versions", json={"sample": {"rows": 800, "seed": 8}})
    assert other.status_code == 201, other.text
    assert other.json()["number"] == 2 and other.json()["sample"]["seed"] == 8
    assert set(inputs(harness, other.json())) != set(inputs(harness, first))
    twin = created(harness, source, "Twin", {"rows": 800, "seed": 7})
    assert twin.json()["dataset_version"]["hash"] == first["hash"]
    with harness.sessions() as session:
        events = list(session.scalars(select(AuditEvent).where(AuditEvent.action == "dataset.sample")))
    assert [(event.target, event.detail["seed"], event.detail["total"]) for event in events][:2] == [
        ("dataset:tickets", 7, TOTAL),
        ("dataset:tickets", 7, TOTAL),
    ]


def test_a_sample_without_a_seed_gets_one_and_mapping_and_model_paths_take_samples(harness: Harness) -> None:
    source = big_dataset(harness)
    made = created(harness, source, "Tickets", {"rows": 500})
    assert made.status_code == 201, made.text
    sample = made.json()["dataset_version"]["sample"]
    assert sample["rows"] == 500 and sample["seed"] >= 1
    sql = "SELECT text AS input, category AS label FROM tickets WHERE category <> 'bug'"
    refused = harness.client.put("/api/datasets/tickets/mapping", json={"sql": sql})
    assert refused.status_code == 409 and refused.json()["total_rows"] == 3_750
    remapped = harness.client.put("/api/datasets/tickets/mapping", json={"sql": sql, "sample": {"rows": 600}})
    assert remapped.status_code == 200, remapped.text
    assert remapped.json()["dataset_version"]["sample"]["total"] == 3_750


def test_a_sample_above_the_limit_is_refused(harness: Harness) -> None:
    source = big_dataset(harness)
    refused = created(harness, source, "Tickets", {"rows": LIMIT + 1, "seed": 7})
    assert refused.status_code == 409 and "at most 1,000 rows" in refused.json()["detail"]
    assert harness.client.get("/api/datasets/tickets").status_code == 404
    assert created(harness, source, "Tickets", {"rows": 0}).status_code == 422


def test_small_sources_are_unaffected(harness: Harness) -> None:
    source = big_dataset(harness, rows=600)
    plain = created(harness, source, "Tickets")
    assert plain.status_code == 201, plain.text
    assert (plain.json()["dataset_version"]["rows"], plain.json()["dataset_version"]["sample"]) == (600, None)
    asked = harness.client.post("/api/datasets/tickets/versions", json={"sample": {"rows": 900, "seed": 3}})
    assert asked.status_code == 201, asked.text
    assert (asked.json()["number"], asked.json()["rows"], asked.json()["sample"]) == (1, 600, None)
    with harness.sessions() as session:
        assert session.scalars(select(AuditEvent).where(AuditEvent.action == "dataset.sample")).first() is None
