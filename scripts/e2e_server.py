import argparse
import os
import re
import shutil
import threading
from pathlib import Path
from typing import Any

import uvicorn

from minibrain.app import create_app
from minibrain.auth.first_run import setup_link
from minibrain.cli import first_start
from minibrain.ml.completion import Completion
from minibrain.models.hardware import report
from minibrain.registry.models import JobKind
from minibrain.serve.backend import CompletionRequest
from minibrain.settings import load_settings
from minibrain.worker import Worker, WorkerConfig

REPO_ROOT = Path(__file__).resolve().parent.parent
FAKE_JOBS = "scripts.e2e_jobs"
FAKE_KINDS = (JobKind.DOWNLOAD, JobKind.TRAIN, JobKind.EVAL)
LINK_FILE = "setup-link"
HOME_FOLDER = "home"
ENV_PREFIX = "MINIBRAIN_"
WORD = re.compile(r"[a-z0-9]+")


def arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="minibrain for the browser end-to-end test: fake serving and jobs")
    parser.add_argument("--port", type=int, required=True)
    parser.add_argument("--state", type=Path, required=True, help="folder for the install and the setup link")
    parser.add_argument("--web-dist", type=Path, required=True, help="the built web UI")
    return parser.parse_args()


def fresh_install(state: Path, base: str, web_dist: Path) -> Path:
    home = state / HOME_FOLDER
    shutil.rmtree(home, ignore_errors=True)
    home.mkdir(parents=True)
    for name in [name for name in os.environ if name.startswith(ENV_PREFIX)]:
        del os.environ[name]
    os.environ |= {
        "MINIBRAIN_HOME": str(home),
        "MINIBRAIN_WEB_DIST": str(web_dist.resolve()),
        "MINIBRAIN_HF_ENDPOINT": f"{base}/e2e-hub",
        "PYTHONPATH": os.pathsep.join(filter(None, [str(REPO_ROOT), os.environ.get("PYTHONPATH")])),
    }
    return home


def picked_label(choices: tuple[str, ...], message: str) -> str:
    words = set(WORD.findall(message.lower()))
    return next((choice for choice in choices if words & set(WORD.findall(choice.lower()))), choices[0])


class FakeServing:
    def complete(self, request: CompletionRequest) -> Completion:
        message = str(request.messages[-1].get("content") or "") if request.messages else ""
        choices = request.decoding_choices()
        text = picked_label(choices, message) if choices else f"Answer to: {message}"
        return Completion(text=text, prompt_tokens=44, completion_tokens=3, stopped=True, seconds=0.05)

    def status(self) -> list[dict[str, Any]]:
        return []


def start_worker(base: str, home: Path, token: str, stop: threading.Event) -> None:
    config = WorkerConfig(
        api_url=base,
        token=token,
        home=home / "worker",
        kinds=[str(kind) for kind in FAKE_KINDS],
        hardware=report().as_dict(),
        models=home / "models",
        prune=False,
    )
    worker = Worker(config, modules={str(kind): FAKE_JOBS for kind in FAKE_KINDS})
    threading.Thread(target=worker.run_forever, args=(stop,), daemon=True).start()


def main() -> None:
    args = arguments()
    base = f"http://127.0.0.1:{args.port}"
    home = fresh_install(args.state, base, args.web_dist)
    settings = load_settings()
    found = first_start(settings)
    if found.token is None:
        raise SystemExit("the fresh install has no setup link")
    (args.state / LINK_FILE).write_text(setup_link(base, found.token))
    app = create_app(settings=settings, backend=FakeServing())
    stop = threading.Event()
    start_worker(base, home, settings.secret("worker_token"), stop)
    try:
        uvicorn.run(app, host="127.0.0.1", port=args.port, log_level="warning")
    finally:
        stop.set()


if __name__ == "__main__":
    main()
