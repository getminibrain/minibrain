import threading
import time
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass, field
from functools import partial
from pathlib import Path
from typing import Any

import anyio
import httpx
import pytest
from anyio import to_thread
from fastapi.testclient import TestClient

from minibrain.gateway import capacity
from minibrain.gateway.capacity import BUSY_RETRY_SECONDS, Generations
from minibrain.gateway.standalone import create_gateway_app
from minibrain.ml.completion import Completion
from minibrain.registry.models import RequestLog
from minibrain.serve.backend import CompletionRequest
from minibrain.serve.engines import START_RETRY_SECONDS, EngineBackend
from minibrain.settings import GATEWAY_CONCURRENCY, GATEWAY_CONCURRENCY_ENV, gateway_concurrency
from tests.conftest import FakeBackend, Harness
from tests.test_flow import SLUG, add_version
from tests.test_gateway import CHAT, servable

LIMIT = 6
SHARED_THREADS = 4
PROMPT = {"model": SLUG, "prompt": "I was charged twice"}


@dataclass
class Held(FakeBackend):
    gate: threading.Event = field(default_factory=threading.Event)

    def complete(self, request: CompletionRequest) -> Completion:
        self.gate.wait(30)
        return super().complete(request)


class Loading:
    def request(self, method: str, url: str, *, content: Any = None, json: Any = None, headers: Any = None) -> Any:
        return httpx.Response(503, json={"detail": "loading"}, request=httpx.Request(method, url))

    @contextmanager
    def stream(self, method: str, url: str, *, headers: Any = None, json: Any = None) -> Iterator[Any]:
        yield self.request(method, url)


@dataclass
class Measured:
    calls: list[int] = field(default_factory=list)
    refused: httpx.Response | None = None
    others: dict[str, int] = field(default_factory=dict)


def busy_body(reply: Any) -> dict[str, Any]:
    assert reply.status_code == 503
    assert reply.headers["Retry-After"] == str(BUSY_RETRY_SECONDS)
    return reply.json()["error"]


async def while_the_limit_is_full(harness: Harness, key: dict[str, str], claim: dict[str, Any]) -> Measured:
    to_thread.current_default_thread_limiter().total_tokens = SHARED_THREADS
    held: Held = harness.app.state.backend
    generations: Generations = harness.app.state.generations
    worker = {"Authorization": f"Bearer {harness.token}"}
    machine = {"id": "w2", "host": "h2", "kinds": ["train"], "gpus": 1, "pool": "local"}
    measured = Measured()
    transport = httpx.ASGITransport(app=harness.app)
    async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as client:
        client.cookies.update(dict(harness.client.cookies.items()))

        async def call() -> None:
            measured.calls.append((await client.post("/v1/chat/completions", headers=key, json=CHAT)).status_code)

        async with anyio.create_task_group() as group:
            for _ in range(LIMIT):
                group.start_soon(call)
            with anyio.fail_after(10):
                while generations.in_use < LIMIT:
                    await anyio.sleep(0.05)
            await anyio.sleep(0.2)
            with anyio.fail_after(5):
                measured.refused = await client.post("/v1/chat/completions", headers=key, json=CHAT)
                measured.others["/api/jobs"] = (await client.get("/api/jobs")).status_code
                beat = {"token": claim["token"]}
                renewed = await client.post(
                    f"/internal/worker/jobs/{claim['job_id']}/heartbeat", json=beat, headers=worker
                )
                measured.others["heartbeat"] = renewed.status_code
                checked_in = await client.post(
                    "/internal/worker/claim", json={"worker": machine, "wait": 0}, headers=worker
                )
                measured.others["claim"] = checked_in.status_code
            held.gate.set()
    return measured


def test_a_full_v1_limit_answers_503_at_once_while_the_ui_and_workers_still_answer(harness: Harness) -> None:
    key = servable(harness)
    add_version(harness, "lora")
    claim = harness.claim(["train"])
    assert claim is not None
    harness.app.state.backend = Held()
    harness.app.state.generations = Generations(LIMIT)
    measured = anyio.run(while_the_limit_is_full, harness, key, claim)
    error = busy_body(measured.refused)
    assert (error["type"], error["code"], error["param"]) == ("server_error", "overloaded", None)
    assert f"try again in {BUSY_RETRY_SECONDS} s" in error["message"]
    assert measured.others == {"/api/jobs": 200, "heartbeat": 200, "claim": 204}
    assert measured.calls == [200] * LIMIT
    assert harness.app.state.generations.in_use == 0
    harness.flush_logs()
    with harness.sessions() as session:
        statuses = sorted(log.status for log in session.query(RequestLog).filter(RequestLog.model == SLUG))
    assert statuses == [200] * LIMIT + [503]


def test_streams_and_errors_give_their_slot_back(harness: Harness) -> None:
    key = servable(harness)
    generations: Generations = harness.app.state.generations
    streamed = harness.client.post("/v1/chat/completions", headers=key, json=CHAT | {"stream": True})
    assert streamed.status_code == 200 and streamed.text.endswith("data: [DONE]\n\n")
    missing = harness.client.post("/v1/chat/completions", headers=key, json=CHAT | {"model": "nope"})
    assert missing.status_code == 404
    assert generations.in_use == 0


def test_a_call_to_an_engine_still_starting_answers_503_with_retry_after(
    harness: Harness, monkeypatch: pytest.MonkeyPatch
) -> None:
    key = servable(harness)
    monkeypatch.setattr(capacity, "START_WAIT_SECONDS", 0.5)
    replica = {"url": "http://127.0.0.1:9", "state": "loading", "pool": "local"}
    harness.app.state.backend = EngineBackend(lambda: {"qwen3-0.6b": [replica]}, http=Loading())
    for body in (CHAT, CHAT | {"stream": True}):
        started = time.monotonic()
        reply = harness.client.post("/v1/chat/completions", headers=key, json=body)
        assert time.monotonic() - started < 5
        assert reply.status_code == 503
        assert reply.headers["Retry-After"] == str(START_RETRY_SECONDS)
        assert "qwen3-0.6b is starting" in reply.json()["detail"]
    assert harness.app.state.generations.in_use == 0


def test_the_standalone_gateway_has_the_same_limit(harness: Harness, tmp_path: Path) -> None:
    key = servable(harness)
    token = harness.settings.secret("gateway_token")
    gateway_app = partial(create_gateway_app, "http://main", token, tmp_path, http=harness.client, background=False)
    app = gateway_app(backend=FakeBackend(), concurrency=1)
    assert app.state.gateway_config.poll(0)
    generations: Generations = app.state.generations
    with TestClient(app) as gateway:
        assert gateway.portal is not None
        slot = gateway.portal.call(generations.admit)
        for path, body in (("/v1/chat/completions", CHAT), ("/v1/completions", PROMPT)):
            assert busy_body(gateway.post(path, headers=key, json=body))["code"] == "overloaded"
        gateway.portal.call(generations.release, slot)
        assert gateway.post("/v1/chat/completions", headers=key, json=CHAT).status_code == 200
    assert generations.in_use == 0


def test_the_limit_is_read_from_the_environment(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv(GATEWAY_CONCURRENCY_ENV, raising=False)
    assert gateway_concurrency() == GATEWAY_CONCURRENCY
    monkeypatch.setenv(GATEWAY_CONCURRENCY_ENV, "8")
    assert gateway_concurrency() == 8
    for wrong in ("0", "many"):
        monkeypatch.setenv(GATEWAY_CONCURRENCY_ENV, wrong)
        with pytest.raises(ValueError, match=GATEWAY_CONCURRENCY_ENV):
            gateway_concurrency()
