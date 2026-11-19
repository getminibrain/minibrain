import os
import shutil
import threading
import time
from pathlib import Path

import duckdb
import psutil
import pytest

from minibrain.data.runs import (
    MIB,
    MIN_RUN_MEMORY_MIB,
    PREVIEW_MEMORY_SHARE,
    PREVIEW_RUNS,
    PREVIEW_SLOTS,
    PREVIEW_THREAD_SHARE,
    SLOTS,
    PreviewCaps,
    PreviewsBusy,
    QueryCancelled,
    cancel,
    caps_for,
    preview_caps,
    running,
    spill_root,
)
from minibrain.data.sources import PREVIEW_OUT_OF_MEMORY, ShapeLimits, SourceError, run_query
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
    assert set(checks) == {"empty", "single_label", "duplicates", "conflicts", "balance", "length", "personal_data"}
    assert checks["duplicates"]["status"] == "warning"
    assert checks["conflicts"]["status"] == "warning"
    assert found["example"][-1] == {"role": "assistant", "content": "billing"}
    assert found["checked"] == 43
    settings = harness.client.get("/api/settings/data").json()
    assert (settings["long_tokens"], settings["chars_per_token"], settings["min_label_rows"]) == (2048, 4, 10)
    duplicates, conflicts = checks["duplicates"], checks["conflicts"]
    assert (duplicates["rows"], duplicates["handled"], duplicates["columns"]) == (3, True, ["Input", "Rows"])
    assert duplicates["table"] == [["same words", "3"]]
    assert (conflicts["rows"], conflicts["handled"], conflicts["table"]) == (3, False, [["same words", "billing, bug"]])


def test_a_large_result_runs_the_quick_checks_on_a_sample(harness: Harness, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("minibrain.api.data.SHAPE_LIMITS", ShapeLimits(rows=20, chars=10**9, labels=257))
    upload(harness, "tickets.csv", repeated_csv())
    found = harness.client.post("/api/query/shape", json={"sql": PAIRS}).json()
    assert (found["rows"], found["checked"], found["quality"]["rows"]) == (43, 20, 43)
    checks = {check["check"]: check for check in found["checks"]}
    assert checks["empty"]["detail"].startswith("41 rows")


def test_label_balance_of_a_sampled_result_counts_every_row(harness: Harness, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("minibrain.api.data.SHAPE_LIMITS", ShapeLimits(rows=20, chars=10**9, labels=257))
    lines = ["text,category", *(f"ticket {index},{'billing' if index % 2 else 'bug'}" for index in range(200))]
    lines += [f"odd {index},odd" for index in range(3)]
    upload(harness, "tickets.csv", ("\n".join(lines) + "\n").encode())
    found = harness.client.post("/api/query/shape", json={"sql": PAIRS}).json()
    balance = {check["check"]: check for check in found["checks"]}["balance"]
    assert found["checked"] == 20
    assert (balance["count"], balance["rows"]) == (1, 3)
    assert balance["table"] == [["odd", "3"]]


def test_long_inputs_shrink_the_sample_to_the_text_budget(harness: Harness, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("minibrain.api.data.SHAPE_LIMITS", ShapeLimits(rows=50_000, chars=2_000, labels=257))
    lines = ["text,category", *(f"{index:03d} {'x' * 96},{'billing' if index % 2 else 'bug'}" for index in range(60))]
    upload(harness, "tickets.csv", ("\n".join(lines) + "\n").encode())
    found = harness.client.post("/api/query/shape", json={"sql": PAIRS}).json()
    assert (found["rows"], found["checked"]) == (60, 20)
    assert found["example"][-1]["role"] == "assistant"


def test_a_query_may_end_in_a_line_comment(harness: Harness) -> None:
    upload(harness, "tickets.csv", tickets_csv())
    commented = f"{PAIRS} -- the tickets"
    shape = harness.client.post("/api/query/shape", json={"sql": commented})
    assert shape.status_code == 200, shape.text
    assert shape.json()["rows"] == 200
    rows = harness.client.post("/api/query", json={"sql": commented, "rows": 3})
    assert rows.status_code == 200, rows.text


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


SETTINGS = (
    "SELECT current_setting('threads') AS threads, current_setting('memory_limit') AS memory, "
    "current_setting('temp_directory') AS spill"
)
BIG_AGGREGATE = (
    "SELECT count(*) AS n FROM (SELECT i % 1000000 AS k, string_agg(i::VARCHAR, ',') AS s FROM range(6000000) t(i) "
    "GROUP BY k)"
)


def formatted_memory(limit: str) -> str:
    with duckdb.connect() as connection:
        connection.execute(f"SET memory_limit = '{limit}'")
        found = connection.execute("SELECT current_setting('memory_limit')").fetchone()
    return str(found[0]) if found else ""


GIB = 1024**3


@pytest.mark.parametrize(
    ("memory", "cores", "expected"),
    [
        (4 * GIB, 2, PreviewCaps(memory_mib=256, threads=1, spill_mib=682)),
        (16 * GIB, 8, PreviewCaps(memory_mib=682, threads=2, spill_mib=2730)),
        (64 * GIB, 16, PreviewCaps(memory_mib=2730, threads=4, spill_mib=10922)),
        (256 * GIB, 64, PreviewCaps(memory_mib=10922, threads=16, spill_mib=43690)),
    ],
)
def test_all_previews_together_share_one_budget(memory: int, cores: int, expected: PreviewCaps) -> None:
    caps = caps_for(memory, cores)
    assert caps == expected
    if caps.memory_mib > MIN_RUN_MEMORY_MIB:
        assert caps.memory_mib * PREVIEW_RUNS * MIB <= memory * PREVIEW_MEMORY_SHARE
    if caps.threads > 1:
        assert caps.threads * PREVIEW_SLOTS <= cores * PREVIEW_THREAD_SHARE


def test_a_preview_run_takes_its_share_and_spills_into_its_own_folder() -> None:
    caps = preview_caps()
    assert caps == caps_for(psutil.virtual_memory().total, os.cpu_count() or 1)
    with running("ana", "editor.rows"):
        capped = run_query([], SETTINGS, None).rows
    assert capped[0][:2] == [caps.threads, formatted_memory(caps.memory)]
    spill = Path(capped[0][2])
    assert spill.parent == spill_root()
    assert not spill.exists()
    with running("ana", None):
        assert run_query([], SETTINGS, None).rows[0][:2] == capped[0][:2]
    assert run_query([], SETTINGS, None).rows[0][:2] != capped[0][:2]


def test_a_preview_reads_no_other_preview_spill() -> None:
    other = spill_root() / "1-other"
    other.mkdir(parents=True)
    (other / "secret.tmp").write_text("x")
    try:
        with pytest.raises(SourceError), running("ana", "editor.rows"):
            run_query([], f"SELECT * FROM read_text('{other}/secret.tmp')", None)
    finally:
        shutil.rmtree(other)


def test_a_query_outside_previews_spills_into_its_own_folder_and_reads_no_other() -> None:
    spill = Path(run_query([], SETTINGS, None).rows[0][2])
    assert spill.parent == spill_root(preview=False)
    assert not spill.exists()
    other = spill_root(preview=False) / "1-other"
    other.mkdir(parents=True)
    (other / "secret.tmp").write_text("x")
    try:
        with pytest.raises(SourceError):
            run_query([], f"SELECT * FROM read_text('{other}/secret.tmp')", None)
    finally:
        shutil.rmtree(other)


def test_a_preview_that_outgrows_its_memory_spills_or_says_what_to_do(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        "minibrain.data.runs.preview_caps", lambda: PreviewCaps(memory_mib=64, threads=1, spill_mib=1024)
    )
    with running("ana", "editor.shape"):
        assert run_query([], BIG_AGGREGATE, None).rows == [[1_000_000]]
    monkeypatch.setattr("minibrain.data.runs.preview_caps", lambda: PreviewCaps(memory_mib=64, threads=1, spill_mib=1))
    with pytest.raises(SourceError) as raised, running("ana", "editor.shape"):
        run_query([], BIG_AGGREGATE, None)
    assert str(raised.value) == PREVIEW_OUT_OF_MEMORY
    assert not SLOTS


def test_a_page_runs_at_most_its_rows_shape_and_count_at_once(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("minibrain.data.runs.PREVIEW_WAIT_SECONDS", 0.3)
    outcome: list[BaseException | None] = []
    names = [f"editor.{part}" for part in ("rows", "shape", "count")]
    threads = [slow_run("ana", name, outcome) for name in names]
    try:
        with pytest.raises(PreviewsBusy), running("ana", "editor.extra"):
            pass
    finally:
        stopped(*(("ana", name, thread) for name, thread in zip(names, threads, strict=True)))
    assert not SLOTS


def stopped(*runs: tuple[str, str, threading.Thread]) -> None:
    for owner, name, thread in runs:
        cancel(owner, name)
        thread.join(timeout=10)
        assert not thread.is_alive()


def test_two_pages_of_the_same_person_preview_at_once() -> None:
    outcome: list[BaseException | None] = []
    first = slow_run("ana", "editor-1.rows", outcome)
    try:
        with running("ana", "editor-2.rows"):
            assert run_query([], "SELECT 1 AS n", None).rows == [[1]]
        assert first.is_alive()
    finally:
        stopped(("ana", "editor-1.rows", first))
    assert isinstance(outcome[0], QueryCancelled)


def test_a_third_preview_waits_for_a_turn_then_is_refused(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("minibrain.data.runs.PREVIEW_WAIT_SECONDS", 0.5)
    outcome: list[BaseException | None] = []
    first = slow_run("ana", "editor-1.rows", outcome)
    second = slow_run("bob", "editor-2.rows", outcome)
    try:
        with running("ana", "editor-1.shape"):
            assert run_query([], "SELECT 1 AS n", None).rows == [[1]]
        started = time.monotonic()
        with (
            pytest.raises(PreviewsBusy, match="Previews are busy"),
            running("cy", "editor-3.rows"),
        ):
            pass
        assert time.monotonic() - started >= 0.5
    finally:
        stopped(("ana", "editor-1.rows", first), ("bob", "editor-2.rows", second))
    assert not SLOTS


def test_a_waiting_preview_runs_when_a_turn_frees(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("minibrain.data.runs.PREVIEW_WAIT_SECONDS", 10.0)
    outcome: list[BaseException | None] = []
    first = slow_run("ana", "editor-1.rows", outcome)
    second = slow_run("bob", "editor-2.rows", outcome)
    threading.Timer(0.3, cancel, ["ana", "editor-1.rows"]).start()
    try:
        with running("cy", "editor-3.rows"):
            assert run_query([], "SELECT 1 AS n", None).rows == [[1]]
    finally:
        stopped(("ana", "editor-1.rows", first), ("bob", "editor-2.rows", second))
    assert not SLOTS


def test_a_turn_frees_when_a_preview_fails_or_times_out(harness: Harness, monkeypatch: pytest.MonkeyPatch) -> None:
    with pytest.raises(SourceError), running("ana", "editor-1.rows"):
        run_query([], "SELECT nothing FROM nowhere", None)
    assert not SLOTS
    monkeypatch.setattr("minibrain.data.sources.QUERY_TIMEOUT_SECONDS", 0.3)
    with pytest.raises(SourceError, match="was stopped"), running("ana", "editor-1.rows"):
        run_query([], SLOW, None)
    assert not SLOTS


def test_a_busy_server_answers_503_with_what_to_do(harness: Harness, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("minibrain.data.runs.PREVIEW_WAIT_SECONDS", 0.2)
    upload(harness, "tickets.csv", tickets_csv())
    outcome: list[BaseException | None] = []
    first = slow_run("ana", "editor-1.rows", outcome)
    second = slow_run("bob", "editor-2.rows", outcome)
    try:
        busy = harness.client.post("/api/query", json={"sql": PAIRS, "run": "editor-3.rows"})
    finally:
        stopped(("ana", "editor-1.rows", first), ("bob", "editor-2.rows", second))
    assert (busy.status_code, busy.json()["detail"]) == (503, "Previews are busy. Press Run to try again.")
    assert harness.client.post("/api/query", json={"sql": PAIRS, "run": "editor-3.rows"}).status_code == 200


def test_the_rows_and_the_shape_of_one_preview_run_side_by_side() -> None:
    outcome: list[BaseException | None] = []
    rows = slow_run("ana", "editor-1.rows", outcome)
    with running("ana", "editor-1.shape"):
        assert run_query([], "SELECT 1 AS n", None).rows == [[1]]
        assert rows.is_alive()
    assert cancel("ana", "editor-1.rows")
    rows.join(timeout=10)
    assert isinstance(outcome[0], QueryCancelled)
