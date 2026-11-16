import json
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import pytest
from sqlalchemy import Executable, delete, update
from transformers import TrainerControl, TrainerState, TrainingArguments

from minibrain.api import jobs
from minibrain.auth.roles import Role
from minibrain.jobs.output import OutputParser, guess_level, structured
from minibrain.ml import train
from minibrain.ml.context import emit
from minibrain.registry.models import LoginSession, Model, User, Version
from tests.conftest import Harness, fake_adapter
from tests.test_flow import SLUG, add_version, create_with_dataset
from tests.test_worker import FAKE, queued_training


class Ticks:
    def __init__(self) -> None:
        self.moment = datetime(2026, 11, 6, 12, tzinfo=UTC)

    def __call__(self) -> datetime:
        return self.moment

    def advance(self, seconds: float) -> None:
        self.moment += timedelta(seconds=seconds)


def feed(parser: OutputParser, lines: list[str]) -> list[dict[str, Any]]:
    return [record for line in lines for record in parser.feed(line)] + parser.flush(final=True)


def test_our_json_lines_become_events_and_other_lines_stay_text() -> None:
    ours = json.dumps({"ts": "2026-11-06T12:00:00.000+00:00", "level": "info", "event": "train.step", "message": "m"})
    records = feed(OutputParser(), [ours, '{"progress": 1.0, "latency": 3}', "scored 40/162", "{not json"])
    assert [(record["kind"], record["name"]) for record in records] == [
        ("event", "train.step"),
        ("log", None),
        ("log", None),
        ("log", None),
    ]
    assert records[0]["at"] == "2026-11-06T12:00:00.000+00:00"
    assert records[0]["data"] is None
    assert structured('{"event": "x", "level": "loud"}') is None


@pytest.mark.parametrize(
    ("line", "level"),
    [
        ("W1106 15:54:54.156000 56775 redirects.py:35] NOTE: Redirects are not supported", "warning"),
        ("E1106 15:54:54.156000 56775 x.py:1] failed to bind", "error"),
        ("I1106 15:54:54.156000 56775 x.py:1] ready", "info"),
        ("/x/generation/utils.py:120: UserWarning: do_sample is False", "warning"),
        ("WARNING: the cache is cold", "warning"),
        ("[2026-11-06 15:54:54] ERROR: lost the GPU", "error"),
        ("RuntimeError: MPS backend out of memory", "error"),
        ("DEBUG loading shard 1", "debug"),
        ("[transformers] The following generation flags are not valid", "info"),
        ("scored 40/162", "info"),
    ],
)
def test_text_lines_get_a_guessed_level(line: str, level: str) -> None:
    assert guess_level(line) == level


def test_a_traceback_is_one_error_with_its_lines() -> None:
    lines = [
        "Traceback (most recent call last):",
        '  File "train.py", line 3, in <module>',
        "    main()",
        "ValueError: first",
        "",
        "During handling of the above exception, another exception occurred:",
        "",
        "Traceback (most recent call last):",
        '  File "train.py", line 9, in <module>',
        "RuntimeError: second",
        "next line",
    ]
    records = feed(OutputParser(), lines)
    assert [(record["level"], record["message"]) for record in records] == [
        ("error", "RuntimeError: second"),
        ("info", "next line"),
    ]
    assert records[0]["data"]["traceback"] == "\n".join(lines[:-1])


def test_a_finished_traceback_is_sent_without_waiting_for_the_next_line() -> None:
    parser = OutputParser()
    feed_lines = ["Traceback (most recent call last):", '  File "x.py", line 1', "KeyError: 'a'"]
    assert [record for line in feed_lines for record in parser.feed(line)] == []
    assert [record["message"] for record in parser.flush()] == ["KeyError: 'a'"]
    assert parser.flush() == []


def test_an_unfinished_traceback_waits_then_goes_out_when_stale() -> None:
    ticks = Ticks()
    parser = OutputParser(ticks)
    parser.feed("Traceback (most recent call last):")
    parser.feed('  File "x.py", line 1')
    assert parser.flush() == []
    ticks.advance(6)
    assert [record["level"] for record in parser.flush()] == ["error"]


def lines_of(capsys: pytest.CaptureFixture[str]) -> list[dict[str, Any]]:
    return [json.loads(line) for line in capsys.readouterr().out.splitlines()]


class Seconds:
    def __init__(self) -> None:
        self.value = 100.0

    def __call__(self) -> float:
        return self.value


def arguments(tmp_path: Path) -> TrainingArguments:
    return TrainingArguments(output_dir=str(tmp_path), use_cpu=True, report_to="none")


def test_the_training_callback_emits_step_and_held_out_events(
    capsys: pytest.CaptureFixture[str], tmp_path: Path
) -> None:
    seconds = Seconds()
    callback = train.MetricsCallback(lambda: 2_000_000_000, seconds)
    args, control = arguments(tmp_path), TrainerControl()
    state = TrainerState(max_steps=200, global_step=0)
    callback.on_train_begin(args, state, control)
    state.global_step, state.epoch, seconds.value = 10, 0.5, 120.0
    logs = {"loss": 1.25, "learning_rate": 2e-4, "grad_norm": 0.8, "num_tokens": 40_000.0, "mean_token_accuracy": 0.6}
    callback.on_log(args, state, control, logs=logs)
    state.global_step, seconds.value = 20, 130.0
    callback.on_log(args, state, control, logs={"loss": 1.0, "num_tokens": 60_000.0})
    callback.on_log(args, state, control, logs={"eval_loss": 1.1, "eval_runtime": 3.0})
    callback.on_log(args, state, control, logs={"train_runtime": 40.0, "train_loss": 1.1})
    first, second, held_out = lines_of(capsys)
    assert (first["event"], first["level"], first["progress"]) == ("train.step", "info", 0.05)
    assert first["message"] == "Step 10 of 200: loss 1.2500"
    assert {key: first[key] for key in ("step", "steps", "epoch", "loss", "learning_rate", "grad_norm")} == {
        "step": 10,
        "steps": 200,
        "epoch": 0.5,
        "loss": 1.25,
        "learning_rate": 2e-4,
        "grad_norm": 0.8,
    }
    assert (first["tokens_per_second"], first["eta_seconds"], first["memory_bytes"]) == (2000.0, 380.0, 2_000_000_000)
    assert (second["tokens_per_second"], second["eta_seconds"]) == (2000.0, 270.0)
    assert (first["elapsed_seconds"], second["elapsed_seconds"]) == (20.0, 30.0)
    assert (held_out["event"], held_out["step"], held_out["eval_loss"]) == ("train.eval", 20, 1.1)


def test_a_resumed_run_measures_time_left_from_where_it_resumed(
    capsys: pytest.CaptureFixture[str], tmp_path: Path
) -> None:
    seconds = Seconds()
    callback = train.MetricsCallback(lambda: None, seconds)
    args, control = arguments(tmp_path), TrainerControl()
    state = TrainerState(max_steps=100, global_step=50)
    callback.on_train_begin(args, state, control)
    state.global_step, seconds.value = 60, 120.0
    callback.on_log(args, state, control, logs={"loss": 0.5})
    (line,) = lines_of(capsys)
    assert (line["eta_seconds"], line["tokens_per_second"], line["memory_bytes"]) == (80.0, None, None)


def test_emit_writes_one_line_in_the_event_shape(capsys: pytest.CaptureFixture[str]) -> None:
    emit("score.progress", "Answered 8 of 16 rows", progress=0.5, done=8, total=16)
    (line,) = lines_of(capsys)
    assert {key: line[key] for key in ("level", "event", "message", "progress", "done", "total")} == {
        "level": "info",
        "event": "score.progress",
        "message": "Answered 8 of 16 rows",
        "progress": 0.5,
        "done": 8,
        "total": 16,
    }
    assert structured(json.dumps(line)) is not None


def step(number: int, loss: float, **extra: Any) -> dict[str, Any]:
    data = {"step": number, "steps": 6, "loss": loss, "learning_rate": 1e-4, "progress": number / 6} | extra
    return {"kind": "event", "name": "train.step", "level": "info", "message": f"Step {number}", "data": data}


def held_out(number: int, loss: float) -> dict[str, Any]:
    return {"kind": "event", "name": "train.eval", "message": "", "data": {"step": number, "eval_loss": loss}}


def post(harness: Harness, claim: dict[str, Any], events: list[dict[str, Any]]) -> None:
    body = {"token": claim["token"], "events": events}
    assert harness.internal(f"/jobs/{claim['job_id']}/events", body).status_code == 204


def finish(harness: Harness, claim: dict[str, Any]) -> None:
    outputs = {"adapter": harness.upload(fake_adapter(), "adapter", "tar", "adapter")}
    body = {"token": claim["token"], "result": {"summary": {}}, "outputs": outputs}
    assert harness.internal(f"/jobs/{claim['job_id']}/complete", body).status_code == 204


def start(harness: Harness) -> dict[str, Any]:
    claim = harness.claim(["train"])
    assert claim is not None
    return claim


def test_the_job_page_reads_training_curves_from_stored_events(harness: Harness) -> None:
    create_with_dataset(harness)
    add_version(harness, "lora")
    claim = start(harness)
    began = {"kind": "event", "name": "train.start", "message": "Training", "data": {"device": "mps"}}
    post(harness, claim, [began, step(1, 2.0), step(2, 1.6), step(3, 1.9)])
    post(harness, claim, [step(2, 1.5, eta_seconds=40, tokens_per_second=900.0, memory_bytes=3_000)])
    post(harness, claim, [held_out(2, 1.4), step(3, 1.2), step(4, 1.0), held_out(4, 1.3)])
    post(harness, claim, [step(5, 0.8), step(6, 0.6, memory_bytes=5_000, elapsed_seconds=42.5), held_out(6, 1.5)])
    job_id = claim["job_id"]
    metrics = harness.client.get(f"/api/jobs/{job_id}/metrics").json()["training"]
    assert [(point["step"], point["loss"]) for point in metrics["points"]] == [
        (1, 2.0),
        (2, 1.5),
        (3, 1.2),
        (4, 1.0),
        (5, 0.8),
        (6, 0.6),
    ]
    assert [(point["step"], point["eval_loss"]) for point in metrics["evals"]] == [(2, 1.4), (4, 1.3), (6, 1.5)]
    assert (metrics["step"], metrics["steps"], metrics["memory_bytes"]) == (6, 6, 5_000)
    assert [point["elapsed_seconds"] for point in metrics["points"]][-2:] == [None, 42.5]
    assert metrics["rising_from"] == 4
    detail = harness.client.get(f"/api/jobs/{job_id}").json()
    assert (detail["device"], detail["host"], detail["live"], detail["progress"]) == ("mps", "test", False, 1.0)


def test_held_out_loss_falling_with_train_loss_gives_no_warning(harness: Harness) -> None:
    create_with_dataset(harness)
    add_version(harness, "lora")
    claim = start(harness)
    post(harness, claim, [step(1, 2.0), held_out(1, 1.9), step(2, 1.5), held_out(2, 1.6), step(3, 1.0)])
    metrics = harness.client.get(f"/api/jobs/{claim['job_id']}/metrics").json()["training"]
    assert metrics["rising_from"] is None


def trained(harness: Harness, losses: list[float], worker: str) -> dict[str, Any]:
    add_version(harness, "lora")
    claim = harness.claim(["train"], worker_id=worker)
    assert claim is not None
    post(harness, claim, [step(index + 1, loss) for index, loss in enumerate(losses)] + [held_out(1, losses[0])])
    finish(harness, claim)
    assert harness.claim(["eval"], worker_id=worker) is not None
    return claim


def comparing(harness: Harness) -> tuple[dict[str, Any], dict[str, Any], dict[str, Any]]:
    create_with_dataset(harness)
    first = trained(harness, [2.0, 1.0], "first-worker")
    second = trained(harness, [1.9, 0.9, 0.7], "second-worker")
    add_version(harness, "lora")
    third = harness.claim(["train"], worker_id="third-worker")
    assert third is not None
    post(harness, third, [step(1, 1.8)])
    return first, second, third


def metrics_of(harness: Harness, claim: dict[str, Any], query: str = "") -> Any:
    return harness.client.get(f"/api/jobs/{claim['job_id']}/metrics{query}")


def set_live(harness: Harness, number: int) -> None:
    with harness.sessions() as session:
        session.execute(update(Model).where(Model.slug == SLUG).values(current_version=number))
        session.commit()


def test_the_next_run_shows_the_previous_versions_curve(harness: Harness) -> None:
    _, second, third = comparing(harness)
    found = metrics_of(harness, third).json()
    previous = found["previous"]
    assert (previous["job_id"], [point["loss"] for point in previous["points"]]) == (second["job_id"], [1.9, 0.9, 0.7])
    assert (previous["version"], previous["same_data"], previous["evals"]) == (2, True, [{"step": 1, "eval_loss": 1.9}])
    assert found["comparable"] == [{"version": 1, "live": False}, {"version": 2, "live": False}]


def test_the_live_version_is_the_default_comparison(harness: Harness) -> None:
    first, _, third = comparing(harness)
    set_live(harness, 1)
    found = metrics_of(harness, third).json()
    assert (found["previous"]["job_id"], found["previous"]["version"]) == (first["job_id"], 1)
    assert found["comparable"] == [{"version": 1, "live": True}, {"version": 2, "live": False}]
    set_live(harness, 3)
    assert metrics_of(harness, third).json()["previous"]["version"] == 2


def test_any_trained_version_can_be_compared(harness: Harness) -> None:
    first, second, third = comparing(harness)
    chosen = metrics_of(harness, third, "?versus=1").json()["previous"]
    assert (chosen["job_id"], [point["loss"] for point in chosen["points"]]) == (first["job_id"], [2.0, 1.0])
    back = metrics_of(harness, second, "?versus=1").json()
    assert back["previous"]["version"] == 1
    assert back["comparable"] == [{"version": 1, "live": False}]
    with harness.sessions() as session:
        session.execute(update(Version).where(Version.number == 1).values(dataset_version_id=None))
        session.commit()
    assert metrics_of(harness, third, "?versus=1").json()["previous"]["same_data"] is False


@pytest.mark.parametrize("versus", [0, 3, 99])
def test_only_another_trained_version_of_the_model_can_be_compared(harness: Harness, versus: int) -> None:
    _, _, third = comparing(harness)
    response = metrics_of(harness, third, f"?versus={versus}")
    assert response.status_code == 404
    assert f"v{versus}" in response.json()["detail"]


def test_viewers_read_a_comparison_and_people_without_a_role_do_not(harness: Harness) -> None:
    _, _, third = comparing(harness)
    path = f"/api/jobs/{third['job_id']}/metrics?versus=1"
    assert harness.person(Role.VIEWER).get(path).json()["previous"]["version"] == 1
    assert harness.person(None).get(path).status_code == 403


def test_score_and_transfer_jobs_report_their_own_progress(harness: Harness) -> None:
    create_with_dataset(harness)
    add_version(harness, "prompt")
    claim = harness.claim(["eval"])
    assert claim is not None
    counted = {"kind": "event", "name": "score.progress", "message": "", "data": {"done": 8, "total": 16}}
    post(harness, claim, [counted])
    metrics = harness.client.get(f"/api/jobs/{claim['job_id']}/metrics").json()
    assert metrics["counted"] == {"done": 8, "total": 16}
    assert metrics["training"] is None


def test_the_event_stream_carries_level_source_and_name(harness: Harness, monkeypatch: pytest.MonkeyPatch) -> None:
    queued_training(harness)
    monkeypatch.setenv("FAKE_JOB_NOISE", "1")
    assert harness.worker(kinds=["train"], modules=FAKE).run_once()
    job_id = harness.client.get(f"/api/jobs?model={SLUG}&kind=train").json()["items"][0]["id"]
    stream = harness.client.get(f"/api/jobs/{job_id}/events").text
    events = [json.loads(line[6:]) for line in stream.splitlines() if line.startswith('data: {"id"')]
    shown = [(event["source"], event["level"], event["name"], event["message"]) for event in events]
    assert shown[0] == ("system", "info", None, "queued")
    assert ("minibrain", "info", "train.step", "half way") in shown
    assert ("library", "warning", None, events[3]["message"]) == shown[3]
    assert "Redirects" in events[3]["message"]
    assert ("library", "info", None, '{"not": "ours"}') in shown
    traceback = next(event for event in events if event["message"] == "ValueError: noisy")
    assert (traceback["level"], traceback["data"]["traceback"].count("\n")) == ("error", 2)
    assert shown[-1] == ("system", "info", None, "succeeded")
    step_event = next(event for event in events if event["name"] == "train.step")
    assert step_event["data"]["loss"] == 1.5
    assert harness.client.get(f"/api/jobs/{job_id}/metrics").json()["training"]["points"][0]["loss"] == 1.5


@pytest.mark.parametrize(
    "ending",
    [delete(LoginSession), update(User).values(disabled=True)],
    ids=["signed out", "turned off"],
)
def test_the_event_stream_stops_once_its_reader_may_no_longer_see_it(
    harness: Harness, monkeypatch: pytest.MonkeyPatch, ending: Executable
) -> None:
    queued_training(harness)
    job_id = harness.client.get(f"/api/jobs?model={SLUG}&kind=train").json()["items"][0]["id"]
    reads = jobs.events_after

    def then_end(*args: Any) -> tuple[Any, bool]:
        found = reads(*args)
        with harness.sessions() as session:
            session.execute(ending)
            session.commit()
        return found

    monkeypatch.setattr(jobs, "events_after", then_end)
    monkeypatch.setattr(jobs, "RECHECK_SECONDS", 0.0)
    monkeypatch.setattr(jobs, "EVENT_POLL_SECONDS", 0.01)
    stream = harness.client.get(f"/api/jobs/{job_id}/events").text
    assert '"message":"queued"' in stream
    assert stream.rstrip().splitlines()[-2:] == ["event: signed_out", f'data: {{"job": {job_id}}}']
