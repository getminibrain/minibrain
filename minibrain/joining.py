import json
import os
import secrets
import threading
from collections.abc import Callable
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Protocol

import httpx

from minibrain.auth.join_requests import APPROVED, PENDING, REQUEST_PREFIX

APPROVAL_FILE = "approval.json"
POLL_SECONDS = 3.0
HARDWARE_KEYS = ("system", "arch", "cpu_count", "ram_bytes", "accelerator", "accelerator_name", "gpus")
ENDINGS = {
    "denied": "an admin denied this machine",
    "expired": "nobody approved this machine within an hour; run minibrain worker again to ask again",
    "revoked": "an admin removed this machine; run minibrain worker again to ask again",
}


class Http(Protocol):
    def request(self, method: str, url: str, *, json: Any = ..., headers: Any = ...) -> Any: ...


class JoinRefused(Exception):
    pass


@dataclass(frozen=True)
class Approval:
    main: str
    pool: str
    credential: str


@dataclass(frozen=True)
class Asked:
    key: str
    code: str


def same_main(left: str, right: str) -> bool:
    return left.rstrip("/") == right.rstrip("/")


def approval_path(home: Path) -> Path:
    return home / "worker" / APPROVAL_FILE


def saved(home: Path, main: str) -> Approval | None:
    path = approval_path(home)
    try:
        found = Approval(**json.loads(path.read_text()))
    except (OSError, ValueError, TypeError):
        return None
    return found if same_main(found.main, main) else None


def save(home: Path, approval: Approval) -> None:
    path = approval_path(home)
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(descriptor, "w") as file:
        json.dump(asdict(approval), file)


def forget(home: Path) -> None:
    approval_path(home).unlink(missing_ok=True)


def hardware_summary(report: dict[str, Any]) -> dict[str, Any]:
    return {key: report[key] for key in HARDWARE_KEYS if key in report}


def refusal(response: httpx.Response) -> str:
    try:
        return str(response.json().get("detail") or response.text)
    except ValueError:
        return response.text


def headers(key: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {key}"}


def ask(client: Http, host: str, hardware: dict[str, Any], pool: str | None) -> Asked:
    key = REQUEST_PREFIX + secrets.token_urlsafe(32)
    body = {"host": host, "pool": pool, "hardware": hardware_summary(hardware)}
    response = client.request("POST", "/internal/join/requests", json=body, headers=headers(key))
    if response.status_code != 201:
        raise JoinRefused(f"main refused the join request: {refusal(response)}")
    return Asked(key, str(response.json()["code"]))


def answer(client: Http, asked: Asked) -> dict[str, Any] | None:
    try:
        response = client.request("GET", "/internal/join/requests/self", headers=headers(asked.key))
    except httpx.TransportError:
        return None
    if response.status_code != 200:
        raise JoinRefused(refusal(response))
    return dict(response.json())


def wait(client: Http, main: str, asked: Asked, stop: threading.Event, poll: float = POLL_SECONDS) -> Approval | None:
    while True:
        found = answer(client, asked)
        state = found["state"] if found is not None else PENDING
        if found is not None and state == APPROVED:
            return Approval(main, str(found["pool"]), str(found["credential"]))
        if state != PENDING:
            raise JoinRefused(ENDINGS.get(state, f"the join request ended: {state}"))
        if stop.wait(poll):
            return None


def say_now(text: str) -> None:
    print(text, flush=True)


def waiting_text(asked: Asked, pool: str | None) -> str:
    where = f" pool {pool}" if pool else ""
    return (
        f"This machine asked main to join{where}. Code {asked.code}: "
        "waiting for approval in Infrastructure, Machines (the request lasts an hour)."
    )


def approval(
    client: Http,
    main: str,
    host: str,
    hardware: dict[str, Any],
    pool: str | None,
    stop: threading.Event,
    say: Callable[[str], None] = say_now,
) -> Approval | None:
    asked = ask(client, host, hardware, pool)
    say(waiting_text(asked, pool))
    found = wait(client, main, asked, stop)
    if found is not None:
        say(f"Approved: this machine joins pool {found.pool}.")
    return found
