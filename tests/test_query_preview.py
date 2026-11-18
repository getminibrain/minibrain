import threading
import time

import pytest

from minibrain.data.runs import QueryCancelled, cancel, running
from minibrain.data.sources import run_query
from tests.conftest import Harness, tickets_csv

SLOW = "SELECT count(*) AS n FROM range(200000) a, range(200000) b"
PAIRS = "SELECT text AS input, category AS label FROM tickets"


def upload(harness: Harness, name: str, data: bytes) -> dict:
    response = harness.client.post("/api/sources", files={"file": (name, data, "text/csv")})
    assert response.status_code == 201, response.text
    return response.json()


def repeated_csv() -> bytes:
    lines = ["text,category", "same words,billing", "same words,billing", "same words,bug"]
    lines += [f"ticket {index},{'billing' if index % 2 else 'bug'}" for index in range(40)]
    return ("\n".join(lines) + "\n").encode()


def test_a_run_returns_at_most_the_rows_asked_for(harness: Harness) -> None:
    upload(harness, "tickets.csv", tickets_csv())
    ran = harness.client.post("/api/query", json={"sql": PAIRS, "rows": 5, "run": "editor-1.rows"})
    assert ran.status_code == 200, ran.text
    assert ran.json()["columns"] == ["input", "label"]
    assert len(ran.json()["rows"]) == 5
    assert len(harness.client.post("/api/query", json={"sql": PAIRS}).json()["rows"]) == 50
    assert harness.client.post("/api/query", json={"sql": PAIRS, "rows": 501}).status_code == 422
    assert harness.client.post("/api/query", json={"sql": PAIRS, "run": "no spaces"}).status_code == 422


def test_the_shape_counts_rows_labels_and_runs_the_quick_checks(harness: Harness) -> None:
    upload(harness, "tickets.csv", repeated_csv())
    shape = harness.client.post("/api/query/shape", json={"sql": PAIRS, "run": "editor-1.shape"})
    assert shape.status_code == 200, shape.text
    found = shape.json()
    assert found["rows"] == 43
    assert found["missing"] == []
    assert found["quality"]["labels"] == 2
    assert found["quality"]["duplicates"] == 2
    assert found["largest_share"] == pytest.approx(22 / 43)
    checks = {check["check"]: check for check in found["checks"]}
    assert set(checks) == {"empty", "single_label", "duplicates", "conflicts", "balance", "length"}
    assert checks["duplicates"]["status"] == "warning"
    assert checks["conflicts"]["status"] == "warning"
    assert found["example"][-1] == {"role": "assistant", "content": "billing"}


def test_the_shape_names_the_missing_column_instead_of_failing(harness: Harness) -> None:
    upload(harness, "tickets.csv", tickets_csv())
    shape = harness.client.post("/api/query/shape", json={"sql": "SELECT text AS input FROM tickets"})
    assert shape.status_code == 200, shape.text
    found = shape.json()
    assert (found["rows"], found["missing"], found["quality"], found["checks"]) == (200, ["label"], None, None)
    neither = harness.client.post("/api/query/shape", json={"sql": "SELECT text FROM tickets"}).json()
    assert neither["missing"] == ["input", "label"]
    ran = harness.client.post("/api/query", json={"sql": "SELECT text AS input FROM tickets"})
    assert ran.status_code == 200, ran.text


def test_a_dataset_shape_reads_its_source_alias(harness: Harness) -> None:
    tickets = upload(harness, "tickets.csv", tickets_csv())
    harness.client.post(
        "/api/datasets",
        json={"name": "Tickets", "source_id": tickets["id"], "input_column": "text", "label_column": "category"},
    )
    alias = "SELECT text AS input, category AS label FROM source"
    shape = harness.client.post("/api/datasets/tickets/query/shape", json={"sql": alias})
    assert shape.status_code == 200, shape.text
    assert (shape.json()["rows"], shape.json()["quality"]["labels"]) == (200, 4)
    rows = harness.client.post("/api/datasets/tickets/query", json={"sql": alias, "rows": 3})
    assert len(rows.json()["rows"]) == 3


def test_stopping_an_unknown_run_is_quiet(harness: Harness) -> None:
    assert harness.client.delete("/api/query/runs/editor-1.rows").status_code == 204


def slow_run(owner: str, name: str, outcome: list[BaseException | None]) -> threading.Thread:
    def work() -> None:
        try:
            with running(owner, name):
                run_query([], SLOW, None)
            outcome.append(None)
        except BaseException as error:
            outcome.append(error)

    thread = threading.Thread(target=work)
    thread.start()
    time.sleep(0.5)
    return thread


def test_cancelling_a_run_interrupts_its_query() -> None:
    outcome: list[BaseException | None] = []
    thread = slow_run("ana", "editor.rows", outcome)
    assert not cancel("bob", "editor.rows")
    assert cancel("ana", "editor.rows")
    thread.join(timeout=10)
    assert not thread.is_alive()
    assert isinstance(outcome[0], QueryCancelled)


def test_a_newer_run_with_the_same_name_stops_the_older_one() -> None:
    outcome: list[BaseException | None] = []
    thread = slow_run("ana", "editor.shape", outcome)
    with running("ana", "editor.shape"):
        thread.join(timeout=10)
        assert not thread.is_alive()
        assert isinstance(outcome[0], QueryCancelled)
        assert run_query([], "SELECT 1 AS n", None).rows == [[1]]


def test_new_is_never_a_dataset_slug(harness: Harness) -> None:
    tickets = upload(harness, "tickets.csv", tickets_csv())
    created = harness.client.post("/api/datasets", json={"name": "New", "source_id": tickets["id"]})
    assert created.status_code == 201, created.text
    assert created.json()["slug"] == "new-2"
