from typing import Any

import duckdb
from sqlalchemy import select

from minibrain.registry.files import store_for
from minibrain.registry.models import AuditEvent, DatasetVersion
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


def test_a_model_on_a_dataset_without_a_version_takes_a_sample_when_over_the_limit(harness: Harness) -> None:
    source = big_dataset(harness)
    assert created(harness, source, "Tickets", {"rows": 500, "seed": 3}).status_code == 201
    with harness.sessions() as session:
        for version in session.scalars(select(DatasetVersion)):
            version.dataset = None
        session.commit()
    body = {"name": "Triage", "preset": "classify", "labels": ["billing", "bug"], "dataset": "tickets"}
    refused = harness.client.post("/api/models", json=body)
    assert refused.status_code == 409, refused.text
    assert (refused.json()["total_rows"], refused.json()["row_limit"]) == (TOTAL, LIMIT)
    assert harness.client.get("/api/models/triage").status_code == 404
    made = harness.client.post("/api/models", json=body | {"sample": {"rows": 700, "seed": 5}})
    assert made.status_code == 201, made.text
    version = harness.client.get("/api/datasets/tickets").json()["dataset_version"]
    assert (version["rows"], version["sample"]) == (700, {"rows": 700, "seed": 5, "total": TOTAL})


def full_events(harness: Harness) -> list[AuditEvent]:
    with harness.sessions() as session:
        return list(session.scalars(select(AuditEvent).where(AuditEvent.action == "dataset.full")))


def test_a_full_version_after_a_raised_limit_replaces_the_sample_and_is_audited(harness: Harness) -> None:
    source = big_dataset(harness, rows=1_500)
    sampled = created(harness, source, "Tickets", {"rows": 500, "seed": 3}).json()["dataset_version"]
    assert sampled["sample"] == {"rows": 500, "seed": 3, "total": 1_500}
    assert harness.client.post("/api/datasets/tickets/versions").status_code == 409
    assert full_events(harness) == []
    assert harness.client.put("/api/settings/data", json={"row_limit": 2_000}).status_code == 200
    full = harness.client.post("/api/datasets/tickets/versions")
    assert full.status_code == 201, full.text
    assert (full.json()["number"], full.json()["rows"], full.json()["sample"]) == (2, 1_500, None)
    events = full_events(harness)
    assert [(event.target, event.detail["version"], event.detail["rows"]) for event in events] == [
        ("dataset:tickets", 2, 1_500)
    ]
    assert harness.client.post("/api/datasets/tickets/versions").status_code == 201
    assert len(full_events(harness)) == 1


def test_stats_describe_the_saved_rows_not_the_live_query(harness: Harness) -> None:
    source = big_dataset(harness, rows=1_500)
    sampled = created(harness, source, "Tickets", {"rows": 500, "seed": 3}).json()["dataset_version"]
    stats = harness.client.get(f"/api/dataset-versions/{sampled['id']}/stats")
    assert stats.status_code == 200, stats.text
    quality = stats.json()["quality"]
    assert (quality["rows"], quality["empty"], quality["duplicates"]) == (500, 0, 0)
    assert quality["labels"] == len(stats.json()["label_counts"]) == 4
    assert sum(item["rows"] for item in stats.json()["label_counts"]) == 500
    live = harness.client.get("/api/datasets/tickets/preview").json()["quality"]
    assert live["rows"] == 1_500
    assert harness.client.get("/api/dataset-versions/999/stats").status_code == 404
