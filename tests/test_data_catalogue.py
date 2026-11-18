from pathlib import Path

import pytest

from minibrain.settings import demo_file
from tests.conftest import Harness, blank_dataset, tickets_csv
from tests.test_shared_data import dataset_version_hash, upload


def test_description_and_tags_round_trip_on_sources_and_datasets(harness: Harness) -> None:
    source = upload(harness)
    assert (source["kind"], source["description"], source["tags"]) == ("upload", "", [])
    changed = harness.client.patch(
        f"/api/sources/{source['id']}",
        json={"name": "Support tickets", "description": " Exported from the help desk ", "tags": ["support", " "]},
    ).json()
    assert (changed["name"], changed["filename"], changed["description"], changed["tags"]) == (
        "Support tickets",
        "tickets.csv",
        "Exported from the help desk",
        ["support"],
    )
    assert harness.client.get(f"/api/sources/{source['id']}").json()["tags"] == ["support"]
    harness.client.post("/api/datasets", json={"name": "Tickets", "source_id": source["id"]})
    edited = harness.client.patch(
        "/api/datasets/tickets", json={"description": "Category per ticket", "tags": ["triage", "en", "triage"]}
    ).json()
    assert (edited["slug"], edited["description"], edited["tags"]) == (
        "tickets",
        "Category per ticket",
        ["triage", "en"],
    )
    cleared = harness.client.patch("/api/datasets/tickets", json={"description": "", "tags": []}).json()
    assert (cleared["description"], cleared["tags"], cleared["name"]) == ("", [], "Tickets")
    assert harness.client.patch("/api/datasets/tickets", json={"name": ""}).status_code == 422


def test_dataset_created_with_the_picked_columns(harness: Harness) -> None:
    source = upload(harness)
    body = {"name": "Reversed", "source_id": source["id"], "input_column": "category", "label_column": "text"}
    created = harness.client.post("/api/datasets", json=body).json()
    assert (created["mapping"]["input_column"], created["mapping"]["label_column"]) == ("category", "text")
    single = "SELECT text AS input, category AS label FROM source WHERE category = 'bug'"
    refused = harness.client.post("/api/datasets", json={"name": "Bugs", "source_id": source["id"], "sql": single})
    assert refused.status_code == 409 and refused.json()["detail"].startswith("Only one label")
    sql = "SELECT text AS input, category AS label FROM source WHERE category IN ('bug', 'billing')"
    by_sql = harness.client.post("/api/datasets", json={"name": "Bugs", "source_id": source["id"], "sql": sql}).json()
    assert (by_sql["mapping"]["sql"], by_sql["mapping"]["input_column"]) == (sql, None)
    assert (by_sql["dataset_version"]["number"], by_sql["dataset_version"]["rows"]) == (1, 100)
    bad = {"name": "Broken", "source_id": source["id"], "input_column": "nope", "label_column": "text"}
    assert harness.client.post("/api/datasets", json=bad).status_code == 422
    assert [dataset["slug"] for dataset in harness.client.get("/api/datasets").json()] == ["bugs", "reversed"]


def test_column_stats_come_from_a_bounded_sample(harness: Harness) -> None:
    rows = tickets_csv(30) + b",bug\n"
    source = harness.client.post("/api/sources", files={"file": ("tickets.csv", rows, "text/csv")}).json()
    stats = harness.client.get(f"/api/sources/{source['id']}/stats").json()
    assert (stats["rows"], stats["sampled"]) == (31, 31)
    by_name = {column["name"]: column for column in stats["columns"]}
    assert by_name["text"]["nulls"] == 1
    assert by_name["category"]["type"] == "VARCHAR"
    assert by_name["category"]["distinct"] == 4
    assert (by_name["category"]["min"], by_name["category"]["max"]) == ("account", "feature")
    queried = harness.client.post(
        f"/api/sources/{source['id']}/query", json={"sql": "SELECT category, count(*) AS n FROM source GROUP BY 1"}
    ).json()
    assert queried["columns"] == ["category", "n"] and len(queried["rows"]) == 4


def test_column_stats_carry_samples_lengths_and_a_suggested_pair(harness: Harness) -> None:
    rows = b"id,text,category,lang\n" + b"".join(
        f"{index},a much longer ticket text number {index},{('bug', 'billing')[index % 2]},en\n".encode()
        for index in range(12)
    )
    source = harness.client.post("/api/sources", files={"file": ("profiled.csv", rows, "text/csv")}).json()
    stats = harness.client.get(f"/api/sources/{source['id']}/stats").json()
    by_name = {column["name"]: column for column in stats["columns"]}
    assert by_name["category"]["samples"] == ["billing", "bug"]
    assert by_name["lang"]["samples"] == ["en"]
    assert len(by_name["text"]["samples"]) == 3
    assert all(len(sample) <= 40 for sample in by_name["text"]["samples"])
    assert by_name["id"]["average_length"] is None
    assert by_name["category"]["average_length"] == 5.0
    assert by_name["text"]["average_length"] > 30
    assert (stats["suggested_input"], stats["suggested_label"]) == ("text", "category")


def test_picked_columns_can_skip_rows_with_no_answer(harness: Harness) -> None:
    rows = tickets_csv(20) + b"no answer here,\nblank answer,  \n"
    source = harness.client.post("/api/sources", files={"file": ("gaps.csv", rows, "text/csv")}).json()
    body = {"source_id": source["id"], "input_column": "text", "label_column": "category"}
    kept = harness.client.post("/api/datasets", json={"name": "Kept", **body}).json()
    assert (kept["rows"], kept["mapping"]["skip_empty"]) == (22, False)
    skipped = harness.client.post("/api/datasets", json={"name": "Skipped", **body, "skip_empty": True}).json()
    assert (skipped["rows"], skipped["mode"], skipped["mapping"]["skip_empty"]) == (20, "columns", True)
    assert (skipped["mapping"]["input_column"], skipped["mapping"]["label_column"]) == ("text", "category")
    assert "WHERE" in skipped["mapping"]["sql"]
    again = harness.client.put("/api/datasets/skipped/mapping", json={**body, "skip_empty": False}).json()
    assert (again["rows"], again["mapping"]["skip_empty"]) == (22, False)


def test_picked_columns_combine_several_sources_by_name(harness: Harness) -> None:
    first = upload(harness)
    more = b"category,text,extra\nbug,another ticket,1\nbilling,one more ticket,2\n"
    second = harness.client.post("/api/sources", files={"file": ("more.csv", more, "text/csv")}).json()
    body = {
        "name": "Combined",
        "source_ids": [first["id"], second["id"]],
        "input_column": "text",
        "label_column": "category",
    }
    created = harness.client.post("/api/datasets", json=body).json()
    assert (created["rows"], created["mode"], created["source_id"]) == (202, "columns", None)
    assert [item["id"] for item in created["sources"]] == [first["id"], second["id"]]
    assert "UNION ALL BY NAME" in created["mapping"]["sql"]
    assert created["mapping"]["input_column"] == "text"
    single = harness.client.put("/api/datasets/combined/mapping", json={**body, "source_ids": [second["id"]]}).json()
    assert (single["rows"], single["source_id"]) == (2, second["id"])
    missing = {**body, "name": "Missing", "label_column": "nope"}
    assert harness.client.post("/api/datasets", json=missing).status_code == 422


def test_preview_counts_rows_per_label(harness: Harness) -> None:
    source = upload(harness)
    harness.client.post("/api/datasets", json={"name": "Tickets", "source_id": source["id"]})
    counts = harness.client.get("/api/datasets/tickets/preview").json()["label_counts"]
    assert counts == [{"label": label, "rows": 50} for label in ("account", "billing", "bug", "feature")]


def test_previews_show_more_rows_on_request(harness: Harness) -> None:
    source = upload(harness)
    harness.client.post("/api/datasets", json={"name": "Tickets", "source_id": source["id"]})
    assert len(harness.client.get("/api/datasets/tickets/preview").json()["rows"]) == 20
    assert len(harness.client.get("/api/datasets/tickets/preview?rows=120").json()["rows"]) == 120
    assert len(harness.client.get(f"/api/sources/{source['id']}/rows").json()["rows"]) == 50
    assert len(harness.client.get(f"/api/sources/{source['id']}/rows?rows=150").json()["rows"]) == 150
    assert harness.client.get("/api/datasets/tickets/preview?rows=501").status_code == 422


def test_splits_come_from_the_latest_version(harness: Harness) -> None:
    source = upload(harness)
    harness.client.post("/api/datasets", json={"name": "Tickets", "source_id": source["id"]})
    harness.client.post(
        "/api/models",
        json={
            "dataset": blank_dataset(harness.client),
            "preset": "classify",
            "labels": ["billing", "bug"],
            "name": "Triage",
        },
    )
    harness.client.put("/api/models/triage/dataset", json={"dataset": "tickets"})
    splits = harness.client.get("/api/datasets/tickets").json()["splits"]
    assert (
        dataset_version_hash(harness, "triage")
        == harness.client.get("/api/datasets/tickets").json()["dataset_version"]["hash"]
    )
    assert sum(splits.values()) == 200
    harness.client.patch("/api/datasets/tickets", json={"description": "still the same rows"})
    assert harness.client.get("/api/datasets/tickets").json()["splits"] == splits
    harness.client.put("/api/datasets/tickets/mapping", json={"input_column": "category", "label_column": "text"})
    assert harness.client.get("/api/datasets/tickets").json()["splits"] is None


def large_built_in(monkeypatch: pytest.MonkeyPatch, folder: Path) -> None:
    def located(name: str) -> Path:
        return folder / name if name.startswith("large/") else demo_file(name)

    monkeypatch.setattr("minibrain.data.demo_data.demo_file", located)


def test_demo_data_is_listed_and_can_be_added_again_after_a_delete(
    harness: Harness, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    large_built_in(monkeypatch, tmp_path)
    demos = harness.client.get("/api/demo-data").json()
    assert [(demo["file"], demo["large"]) for demo in demos] == [
        ("demo_travel_intents.jsonl", False),
        ("demo_banking77.csv", False),
        ("demo_clinc150.parquet", False),
    ]
    first = harness.client.post("/api/demo-data/demo_banking77.csv").json()
    assert first["filename"] == "demo_banking77.csv"
    assert first["tags"] == ["minibrain:demo"]
    assert first["rows"] == 13_083
    assert harness.client.delete(f"/api/sources/{first['id']}").status_code == 204
    again = harness.client.post("/api/demo-data/demo_banking77.csv").json()
    assert again["id"] > first["id"]
    assert again["rows"] == 13_083


def test_unknown_demo_data_is_not_found(harness: Harness) -> None:
    assert harness.client.post("/api/demo-data/other.csv").status_code == 404


def test_large_demo_data_is_listed_and_added_once_built(
    harness: Harness, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    large_built_in(monkeypatch, tmp_path)
    missing = harness.client.post("/api/demo-data/demo_dbpedia14.parquet")
    assert missing.status_code == 404
    assert "demo_data/build.py --large" in missing.json()["detail"]
    (tmp_path / "large").mkdir()
    (tmp_path / "large" / "demo_dbpedia14.parquet").write_bytes(demo_file("demo_clinc150.parquet").read_bytes())
    listed = harness.client.get("/api/demo-data").json()
    assert [(demo["name"], demo["rows"], demo["large"]) for demo in listed if demo["large"]] == [
        ("Demo DBpedia-14", 630_000, True)
    ]
    added = harness.client.post("/api/demo-data/demo_dbpedia14.parquet").json()
    assert (added["filename"], added["tags"]) == ("demo_dbpedia14.parquet", ["minibrain:demo"])


def test_a_new_file_never_reads_a_deleted_file_staging(harness: Harness) -> None:
    first = upload(harness)
    assert harness.client.delete(f"/api/sources/{first['id']}").status_code == 204
    second = harness.client.post("/api/demo-data/demo_travel_intents.jsonl").json()
    assert second["rows"] == 750
    assert {column["name"] for column in second["columns"]} != {column["name"] for column in first["columns"]}


def test_tags_keep_key_value_form_and_refuse_the_system_prefix(harness: Harness) -> None:
    source = upload(harness)
    changed = harness.client.patch(
        f"/api/sources/{source['id']}", json={"tags": ["Team : fraud", "eu", "team:fraud", " eu "]}
    )
    assert changed.status_code == 200, changed.text
    assert changed.json()["tags"] == ["team:fraud", "eu"]
    refused = harness.client.patch(f"/api/sources/{source['id']}", json={"tags": ["minibrain:demo"]})
    assert refused.status_code == 422
    assert harness.client.patch(f"/api/sources/{source['id']}", json={"tags": ["team:"]}).status_code == 422


def test_editing_tags_keeps_the_system_tags(harness: Harness) -> None:
    demo = harness.client.post("/api/demo-data/demo_travel_intents.jsonl").json()
    assert demo["tags"] == ["minibrain:demo"]
    edited = harness.client.patch(f"/api/sources/{demo['id']}", json={"tags": ["demo"]}).json()
    assert edited["tags"] == ["minibrain:demo", "demo"]


def test_a_dataset_can_stack_sources_that_share_columns(harness: Harness) -> None:
    sources = [
        harness.client.post("/api/sources", files={"file": (name, tickets_csv(rows), "text/csv")}).json()
        for name, rows in (("march.csv", 200), ("april.csv", 150))
    ]
    sql = "\nUNION ALL\n".join(
        f'SELECT "text" AS input, "category" AS label FROM "{source["table"]}"' for source in sources
    )
    response = harness.client.post("/api/datasets", json={"name": "Tickets", "sql": sql})
    assert response.status_code == 201, response.text
    dataset = response.json()
    assert sorted(source["id"] for source in dataset["sources"]) == sorted(source["id"] for source in sources)
    assert dataset["rows"] == 350
