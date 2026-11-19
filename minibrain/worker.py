import itertools
import json
import logging
import os
import platform
import queue
import shutil
import signal
import subprocess
import sys
import threading
import time
import uuid
from collections.abc import Callable, Iterator
from contextlib import AbstractContextManager
from dataclasses import dataclass, field
from functools import partial
from pathlib import Path
from typing import IO, Any, BinaryIO, Protocol

import httpx

from minibrain.artifacts import CHUNK, ArtifactStore, Packing, Stored, StreamReader
from minibrain.jobs.device_time import device_time
from minibrain.jobs.output import OutputParser, structured
from minibrain.jobs.retention import JOB_FOLDER
from minibrain.ml.context import FINAL_EXIT
from minibrain.models.copies import BUCKET, bucket_client, ensure, matches, opener_for, prune
from minibrain.models.hardware import LOCAL_POOL
from minibrain.models.health import size_problems
from minibrain.models.machine_metrics import Sampler
from minibrain.registry.models import JobKind
from minibrain.telemetry.logs import configure_logging

MODULES: dict[str, str] = {
    JobKind.TRAIN: "minibrain.ml.train",
    JobKind.EVAL: "minibrain.ml.evaluate",
    JobKind.JUDGE: "minibrain.ml.judge",
    JobKind.DOWNLOAD: "minibrain.models.download",
    JobKind.IMPORT: "minibrain.models.importer",
    JobKind.CATALOG_SYNC: "minibrain.models.sync",
    JobKind.VERIFY: "minibrain.models.verify",
    JobKind.REPAIR: "minibrain.models.repair",
    JobKind.EXPORT: "minibrain.ml.export",
}
PASSTHROUGH_KINDS = (JobKind.DOWNLOAD, JobKind.IMPORT, JobKind.CATALOG_SYNC, JobKind.VERIFY, JobKind.REPAIR)
TRANSFER_KINDS = (JobKind.DOWNLOAD, JobKind.IMPORT, JobKind.REPAIR)
LEASE_HEADER = "X-Job-Lease"
WEIGHTS = "weights"
EXPORTED = "export"
PRUNE_SECONDS = 600.0
REMOTE_KINDS = [JobKind.TRAIN, JobKind.EVAL, JobKind.JUDGE, JobKind.EXPORT]
LOCAL_KINDS = list(MODULES)
HEARTBEAT_SECONDS = 15.0
FLUSH_SECONDS = 1.0
MAX_BACKOFF_SECONDS = 30.0
MAX_LEFTOVERS = 10_000
EVENT_BATCH = 200
CLAIM_WAIT_SECONDS = 25.0
RETRIES = 6
STAGED = "file.staged"
JOB_ERROR = "job.error"
QUIET_ENV = {
    "HF_HUB_DISABLE_PROGRESS_BARS": "1",
    "HF_DATASETS_DISABLE_PROGRESS_BARS": "1",
    "TOKENIZERS_PARALLELISM": "false",
    "PYTHONUNBUFFERED": "1",
}


log = logging.getLogger("minibrain.worker")


class LeaseLostError(Exception):
    pass


class WorkerStoppedError(Exception):
    pass


class MachineRemovedError(WorkerStoppedError):
    pass


def refusal_of(response: Any) -> str:
    try:
        return str(response.json().get("detail") or response.text)
    except ValueError:
        return str(response.text)


class Response(Protocol):
    status_code: int
    text: str

    def raise_for_status(self) -> Any: ...

    def json(self) -> Any: ...

    def iter_bytes(self) -> Any: ...


class HttpClient(Protocol):
    def request(self, method: str, url: str, *, content: Any = ..., json: Any = ..., headers: Any = ...) -> Any: ...

    def stream(self, method: str, url: str, *, headers: Any = ..., json: Any = ...) -> AbstractContextManager[Any]: ...


@dataclass
class WorkerConfig:
    api_url: str
    token: str
    home: Path
    kinds: list[str] = field(default_factory=lambda: [str(kind) for kind in REMOTE_KINDS])
    gpus: int = 1
    id: str = field(default_factory=lambda: uuid.uuid4().hex)
    host: str = field(default_factory=platform.node)
    pool: str = LOCAL_POOL
    hardware: dict[str, Any] = field(default_factory=dict)
    models: Path | None = None
    prune: bool = True
    sampler: Sampler | None = None

    @property
    def models_dir(self) -> Path:
        return self.models or self.home / "models"


class MainClient:
    def __init__(self, config: WorkerConfig, http: HttpClient | None = None) -> None:
        self.config = config
        self.http: HttpClient = http or httpx.Client(base_url=config.api_url, timeout=httpx.Timeout(60.0, connect=10.0))
        self.headers = {"Authorization": f"Bearer {config.token}"}
        self.stop = threading.Event()

    def hold(self, lease: str | None) -> None:
        if lease is None:
            self.headers.pop(LEASE_HEADER, None)
        else:
            self.headers[LEASE_HEADER] = lease

    def call(
        self,
        method: str,
        path: str,
        opener: Callable[[], Any] | None = None,
        retries: int | None = None,
        patient: bool = False,
        **kwargs: Any,
    ) -> Response:
        delay = 1.0
        limit = RETRIES if retries is None else retries
        headers = self.headers | kwargs.pop("extra", {})
        for attempt in itertools.count():
            last = not patient and attempt >= limit - 1
            body = opener() if opener is not None else None
            try:
                response = self.http.request(method, path, headers=headers, content=body, **kwargs)
            except httpx.TransportError as error:
                if last:
                    raise
                if attempt == limit - 1:
                    log.warning("main is unreachable (%s); waiting for it to come back", error)
            else:
                if response.status_code == 409:
                    raise LeaseLostError(response.text)
                if response.status_code == 410:
                    raise MachineRemovedError(refusal_of(response))
                if response.status_code < 500 or last:
                    response.raise_for_status()
                    return response
            finally:
                if body is not None and hasattr(body, "close"):
                    body.close()
            if self.stop.wait(delay):
                raise WorkerStoppedError("worker is stopping")
            delay = min(delay * 2, MAX_BACKOFF_SECONDS)
        raise RuntimeError("unreachable")

    def worker_body(self) -> dict[str, Any]:
        config = self.config
        return {
            "id": config.id,
            "host": config.host,
            "kinds": config.kinds,
            "gpus": config.gpus,
            "pool": config.pool,
            "hardware": config.hardware,
        } | ({"metrics": config.sampler.body()} if config.sampler is not None else {})

    def register(self) -> None:
        self.call("POST", "/internal/worker/register", json=self.worker_body())

    def claim(self, wait: float) -> dict[str, Any] | None:
        response = self.call("POST", "/internal/worker/claim", json={"worker": self.worker_body(), "wait": wait})
        return None if response.status_code == 204 else response.json()

    def engines(self) -> dict[str, Any]:
        return dict(self.call("POST", "/internal/worker/engines", json={"worker": self.worker_body()}).json())

    def heartbeat(self, job_id: int, token: str) -> dict[str, Any]:
        return self.call("POST", f"/internal/worker/jobs/{job_id}/heartbeat", json={"token": token}).json()

    def events(self, job_id: int, token: str, events: list[dict[str, Any]], final: bool) -> None:
        body = {"token": token, "events": events}
        retries = None if final else 1
        self.call("POST", f"/internal/worker/jobs/{job_id}/events", retries=retries, patient=final, json=body)

    def complete(
        self, job_id: int, token: str, result: dict[str, Any], outputs: dict[str, str], log: str | None
    ) -> None:
        body = {"token": token, "result": result, "outputs": outputs, "log": log}
        self.call("POST", f"/internal/worker/jobs/{job_id}/complete", patient=True, json=body)

    def fail(
        self, job_id: int, token: str, error: str, retryable: bool, log: str | None, code: str | None = None
    ) -> None:
        body = {"token": token, "error": error, "retryable": retryable, "log": log} | ({"code": code} if code else {})
        self.call("POST", f"/internal/worker/jobs/{job_id}/fail", patient=True, json=body)

    def upload(self, store: ArtifactStore, artifact_id: str, kind: str, packing: str, name: str) -> str:
        headers = {"X-Artifact-Kind": kind, "X-Artifact-Packing": packing, "X-Artifact-Name": name}
        self.call(
            "PUT",
            f"/internal/worker/artifacts/{artifact_id}",
            opener=lambda: file_chunks(store.open(artifact_id)),
            patient=True,
            extra=headers,
        )
        return artifact_id

    def upload_file(self, path: Path, artifact_id: str, name: str, replace: bool) -> None:
        headers = {"X-Artifact-Kind": WEIGHTS, "X-Artifact-Packing": Packing.FILE, "X-Artifact-Name": name}
        headers |= {"X-Artifact-Replace": "1"} if replace else {}
        self.call(
            "PUT",
            f"/internal/worker/artifacts/{artifact_id}",
            opener=lambda: file_chunks(path.open("rb")),
            patient=True,
            extra=headers,
        )

    def stored(self, base_model_id: str) -> list[dict[str, Any]]:
        return list(self.call("GET", f"/internal/worker/bases/{base_model_id}/stored").json()["files"])

    def bases(self, key: str) -> dict[str, Any]:
        return dict(self.call("GET", f"/internal/worker/bases/{key}").json())

    def kept(self, jobs: list[int], artifacts: list[str]) -> tuple[set[int], set[str]]:
        body = {"jobs": jobs[:MAX_LEFTOVERS], "artifacts": artifacts[:MAX_LEFTOVERS]}
        found = self.call("POST", "/internal/worker/kept", json=body).json()
        return set(found["jobs"]), set(found["artifacts"])

    def live_bases(self) -> dict[str, str | None]:
        return dict(self.call("GET", "/internal/worker/bases").json()["bases"])

    def download(self, store: ArtifactStore, artifact_id: str) -> None:
        if store.has(artifact_id):
            return
        with self.http.stream("GET", f"/internal/worker/artifacts/{artifact_id}", headers=self.headers) as response:
            response.raise_for_status()
            store.put_stream(StreamReader(response.iter_bytes()), expected=artifact_id)


def transient(error: httpx.HTTPError) -> bool:
    if isinstance(error, httpx.HTTPStatusError):
        return error.response.status_code >= 500
    return isinstance(error, httpx.TransportError)


def file_chunks(stream: BinaryIO) -> Iterator[bytes]:
    with stream:
        while chunk := stream.read(CHUNK):
            yield chunk


class Publisher:
    def __init__(self, client: MainClient, out: Path, replace: bool) -> None:
        self.client = client
        self.out = out
        self.replace = replace
        self.error: str | None = None
        self.queue: queue.Queue[dict[str, Any] | None] = queue.Queue()
        self.process: subprocess.Popen[bytes] | None = None
        self.thread = threading.Thread(target=self.run, daemon=True)
        self.thread.start()

    def staged(self, line: dict[str, Any]) -> None:
        self.queue.put(line)

    def run(self) -> None:
        while (item := self.queue.get()) is not None:
            if self.error is not None:
                continue
            path = self.out / str(item["staged"])
            try:
                self.client.upload_file(path, str(item["sha256"]), str(item["staged"]), self.replace)
                path.unlink(missing_ok=True)
            except Exception as error:
                self.error = f"could not store {item['staged']} in the bucket: {type(error).__name__}: {error}"
                if self.process is not None:
                    stop_group(self.process)

    def finish(self) -> str | None:
        self.queue.put(None)
        self.thread.join()
        return self.error


class LineCollector:
    def __init__(self, stream: IO[bytes], log_path: Path, publisher: Publisher | None = None) -> None:
        self.stream = stream
        self.log_path = log_path
        self.publisher = publisher
        self.parser = OutputParser()
        self.pending: list[dict[str, Any]] = []
        self.unsent: list[dict[str, Any]] = []
        self.tail: list[str] = []
        self.lock = threading.Lock()
        self.thread = threading.Thread(target=self.pump, daemon=True)
        self.thread.start()

    def pump(self) -> None:
        with self.log_path.open("ab") as log:
            for raw in iter(self.stream.readline, b""):
                log.write(raw)
                log.flush()
                self.add(raw.decode(errors="replace").rstrip("\r\n"))

    def add(self, line: str) -> None:
        with self.lock:
            records = self.parser.feed(line)
            self.pending += records
            self.tail = [*self.tail, line][-50:]
        for record in records:
            if record["name"] == STAGED and self.publisher is not None:
                self.publisher.staged(record["data"] or {})

    def drain(self, final: bool = False) -> list[dict[str, Any]]:
        with self.lock:
            drained, self.pending = self.pending + self.parser.flush(final), []
        return drained


class Lease:
    def __init__(self, client: MainClient, job_id: int, token: str) -> None:
        self.client = client
        self.job_id = job_id
        self.token = token
        self.cancel = threading.Event()
        self.lost = threading.Event()
        self.done = threading.Event()
        self.thread = threading.Thread(target=self.keep, daemon=True)
        self.thread.start()

    def keep(self) -> None:
        while not self.done.wait(HEARTBEAT_SECONDS):
            try:
                if self.client.heartbeat(self.job_id, self.token).get("cancel"):
                    self.cancel.set()
            except LeaseLostError:
                self.lost.set()
                return
            except WorkerStoppedError:
                return
            except Exception:
                log.warning("could not renew the lease on job %s; trying again", self.job_id)

    def end(self) -> None:
        self.done.set()
        self.thread.join()


def failure_from(tail: list[str], exit_code: int) -> tuple[str, bool, str | None]:
    for line in reversed(tail):
        entry = structured(line)
        if entry is not None and entry["event"] == JOB_ERROR:
            code = entry.get("code")
            message = str(entry.get("message") or "failed")
            return message, bool(entry.get("retryable", True)), str(code) if code else None
    return f"exited with code {exit_code}", exit_code != FINAL_EXIT, None


class Worker:
    def __init__(self, config: WorkerConfig, client: MainClient | None = None, modules: dict[str, str] | None = None):
        self.config = config
        self.client = client or MainClient(config)
        self.modules = modules or MODULES
        self.store = ArtifactStore(config.home / "artifacts", config.home / "cache")

    def run_forever(self, stop: threading.Event) -> None:
        configure_logging()
        self.client.stop = stop
        try:
            self.keep_trying(stop)
        except MachineRemovedError as error:
            log.error("%s", error)
            stop.set()
        except WorkerStoppedError:
            return

    def keep_trying(self, stop: threading.Event) -> None:
        registered, pruned, delay = False, 0.0, 1.0
        while not stop.is_set():
            try:
                if not registered:
                    self.client.register()
                    registered = True
                if time.monotonic() - pruned > PRUNE_SECONDS:
                    self.prune_copies()
                    self.prune_leftovers()
                    pruned = time.monotonic()
                self.run_once(CLAIM_WAIT_SECONDS)
                delay = 1.0
            except LeaseLostError:
                continue
            except httpx.HTTPError as error:
                if not transient(error):
                    raise
                log.warning("main is unreachable (%s); trying again in %.0f s", error, delay)
                stop.wait(delay)
                delay = min(delay * 2, MAX_BACKOFF_SECONDS)

    def run_once(self, wait: float = 0.0) -> bool:
        claim = self.client.claim(wait)
        if claim is None:
            return False
        self.run(claim)
        self.prune_leftovers()
        return True

    def job_folders(self) -> dict[int, Path]:
        root = self.config.home / "work"
        found = (JOB_FOLDER.match(entry.name) for entry in root.iterdir()) if root.is_dir() else ()
        return {int(match.group(1)): root / match.group(0) for match in found if match is not None}

    def prune_leftovers(self) -> None:
        folders, artifacts = self.job_folders(), self.store.local_ids()
        if not folders and not artifacts:
            return
        try:
            jobs, needed = self.client.kept(sorted(folders), sorted(artifacts))
        except Exception:
            log.warning("could not check this worker's job files against main")
            return
        for job_id in folders.keys() - jobs:
            shutil.rmtree(folders[job_id], ignore_errors=True)
        for artifact_id in artifacts - needed:
            self.store.delete(artifact_id)

    def prune_copies(self) -> None:
        if not self.config.prune:
            return
        try:
            removed = prune(self.config.models_dir, self.client.live_bases(), lambda entry: entry)
        except Exception:
            log.warning("could not check this worker's model copies against main")
            return
        for key in removed:
            log.info("removed the working copy of %s; main no longer has that model", key)

    def base_copy(self, spec: dict[str, Any]) -> dict[str, Any]:
        if not spec.get("content_hash"):
            return spec
        listing = self.client.bases(str(spec["key"]))
        files, content = listing["files"], listing.get("content_hash")
        local = Path(spec["path"]) if spec.get("path") else None
        if listing.get("store") != BUCKET and local is not None and not size_problems(local, files):
            return spec
        if local is not None and matches(local, files, content):
            return spec
        folder = self.config.models_dir / str(spec["key"])
        files_url = f"/internal/worker/bases/{spec['key']}/files"
        with bucket_client() as bucket:
            relist = partial(self.client.bases, str(spec["key"]))
            opener = opener_for(listing, self.client.http, files_url, self.client.headers, bucket, relist)
            ensure(folder, files, opener, content)
        return spec | {"path": str(folder)}

    def secrets(self, claim: dict[str, Any]) -> bytes | None:
        params = claim["params"]
        if claim["kind"] != JobKind.VERIFY or params.get("store") != BUCKET:
            return None
        return json.dumps(self.client.bases(str(params["base_model_id"]))).encode()

    def publisher(self, claim: dict[str, Any]) -> Publisher | None:
        params = claim["params"]
        if claim["kind"] not in TRANSFER_KINDS or params.get("store") != BUCKET:
            return None
        return Publisher(self.client, Path(params["out"]), replace=claim["kind"] == JobKind.REPAIR)

    def material(self, ref: dict[str, Any] | None) -> str | None:
        if ref is None:
            return None
        self.client.download(self.store, ref["id"])
        return str(self.store.materialize(ref["id"], ref["packing"], ref["name"]))

    def spec(self, claim: dict[str, Any], workdir: Path, attempt_dir: Path) -> dict[str, Any]:
        params = claim["params"]
        spec: dict[str, Any] = {"result": str(attempt_dir / "result.json")}
        if claim["kind"] in TRANSFER_KINDS and params.get("store") == BUCKET:
            spec["stored"] = self.client.stored(str(params["base_model_id"]))
        if claim["kind"] in PASSTHROUGH_KINDS:
            return params | spec
        spec |= {key: params[key] for key in ("slug", "number", "base_model") if key in params}
        if "base_spec" in params:
            spec["base_spec"] = self.base_copy(params["base_spec"])
        spec["dataset_version"] = self.material(params.get("dataset_version"))
        if claim["kind"] == JobKind.TRAIN:
            spec |= {
                "recipe": params["recipe"],
                "plan_base": params.get("plan_base"),
                "prompting": params["prompting"],
                "adapter_out": str(attempt_dir / "out"),
                "checkpoints": str(workdir / "checkpoints"),
            }
        if claim["kind"] == JobKind.EVAL:
            spec |= {
                "version_kind": params["version_kind"],
                "adapter": self.material(params.get("adapter")),
                "prompting": params["prompting"],
                "answer_tokens": params.get("answer_tokens"),
                "pool": self.config.pool,
            }
        if claim["kind"] == JobKind.JUDGE:
            spec |= {key: params[key] for key in ("rubric", "items", "judge", "judge_version")}
            spec["instructions"] = params.get("instructions") or ""
        if claim["kind"] == JobKind.EXPORT:
            spec |= {"adapter": self.material(params["adapter"]), "out": str(attempt_dir / "out")}
        return spec

    def outputs(self, claim: dict[str, Any], attempt_dir: Path) -> dict[str, str]:
        if claim["kind"] == JobKind.TRAIN:
            adapter = self.store.put_dir(attempt_dir / "out")
            return {"adapter": self.hand_over(adapter, "adapter", Packing.TAR, "adapter")}
        if claim["kind"] == JobKind.EXPORT:
            return {EXPORTED: self.export(attempt_dir / "out", str(claim["params"]["name"]))}
        return {}

    def hand_over(self, stored: Stored, kind: str, packing: str, name: str) -> str:
        try:
            return self.client.upload(self.store, stored.id, kind, packing, name)
        finally:
            self.store.delete(stored.id)

    def export(self, folder: Path, name: str) -> str:
        stored = self.store.put_dir(folder)
        shutil.rmtree(folder, ignore_errors=True)
        return self.hand_over(stored, EXPORTED, Packing.TAR, name)

    def upload_log(self, log_path: Path) -> str | None:
        if not log_path.exists():
            return None
        return self.hand_over(self.store.put_file(log_path), "log", Packing.FILE, "log.txt")

    def run(self, claim: dict[str, Any]) -> None:
        job_id, token, kind = claim["job_id"], claim["token"], claim["kind"]
        workdir = self.config.home / "work" / f"job-{job_id}"
        attempt_dir = workdir / f"attempt-{claim['attempt']}"
        shutil.rmtree(attempt_dir, ignore_errors=True)
        attempt_dir.mkdir(parents=True)
        log_path = attempt_dir / "log.txt"
        publisher: Publisher | None = None
        lease = Lease(self.client, job_id, token)
        self.client.hold(token)
        try:
            spec_path = attempt_dir / "spec.json"
            spec_path.write_text(json.dumps(self.spec(claim, workdir, attempt_dir)))
            arguments = [self.modules[kind], str(spec_path)]
            publisher = self.publisher(claim)
            started = time.monotonic()
            exit_code, cancelled, tail = self.supervise(
                job_id, token, lease, arguments, log_path, claim.get("env") or {}, publisher, self.secrets(claim)
            )
            seconds = time.monotonic() - started
            stored_error = publisher.finish() if publisher is not None else None
            log = self.upload_log(log_path)
            if cancelled:
                self.client.fail(job_id, token, "cancelled", False, log)
            elif stored_error is not None:
                self.client.fail(job_id, token, stored_error, True, log)
            elif exit_code == 0:
                result = json.loads((attempt_dir / "result.json").read_text())
                if kind == JobKind.TRAIN:
                    result["device_time"] = device_time(dict(result.get("summary") or {}), seconds)
                self.client.complete(job_id, token, result, self.outputs(claim, attempt_dir), log)
                shutil.rmtree(workdir, ignore_errors=True)
            else:
                error, retryable, code = failure_from(tail, exit_code)
                self.client.fail(job_id, token, error, retryable, log, code)
        except LeaseLostError:
            return
        except Exception as error:
            self.client.fail(job_id, token, f"worker error: {type(error).__name__}: {error}", True, None)
        finally:
            self.client.hold(None)
            lease.end()
            shutil.rmtree(attempt_dir, ignore_errors=True)

    def supervise(
        self,
        job_id: int,
        token: str,
        lease: Lease,
        arguments: list[str],
        log_path: Path,
        env: dict[str, str] | None = None,
        publisher: Publisher | None = None,
        secrets: bytes | None = None,
    ) -> tuple[int, bool, list[str]]:
        process = subprocess.Popen(
            [sys.executable, "-m", *arguments],
            stdin=subprocess.PIPE if secrets is not None else subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            start_new_session=True,
            env=os.environ | QUIET_ENV | (env or {}),
        )
        if process.stdout is None:
            raise RuntimeError("child has no stdout")
        if publisher is not None:
            publisher.process = process
        if secrets is not None and process.stdin is not None:
            with process.stdin:
                process.stdin.write(secrets)
        lines = LineCollector(process.stdout, log_path, publisher)
        cancelled = False
        last_flush, flush_every = time.monotonic(), FLUSH_SECONDS
        try:
            while process.poll() is None:
                time.sleep(0.2)
                if lease.lost.is_set():
                    raise LeaseLostError(f"job {job_id} is no longer leased to this worker")
                if lease.cancel.is_set() and not cancelled:
                    cancelled = True
                    stop_group(process)
                moment = time.monotonic()
                if moment - last_flush >= flush_every:
                    sent = self.flush(job_id, token, lines)
                    flush_every = FLUSH_SECONDS if sent else min(flush_every * 2, MAX_BACKOFF_SECONDS)
                    last_flush = moment
        except BaseException:
            stop_group(process)
            raise
        lines.thread.join(timeout=10)
        self.flush(job_id, token, lines, final=True)
        return process.returncode, cancelled, lines.tail

    def flush(self, job_id: int, token: str, lines: LineCollector, final: bool = False) -> bool:
        lines.unsent += lines.drain(final)
        while lines.unsent:
            try:
                self.client.events(job_id, token, lines.unsent[:EVENT_BATCH], final)
            except httpx.HTTPError as error:
                if not transient(error):
                    raise
                log.warning("main is unreachable; keeping %d events of job %s to send later", len(lines.unsent), job_id)
                return False
            del lines.unsent[:EVENT_BATCH]
        return True


def stop_group(process: subprocess.Popen[bytes]) -> None:
    if process.poll() is not None:
        return
    try:
        os.killpg(process.pid, signal.SIGTERM)
        process.wait(timeout=20)
    except subprocess.TimeoutExpired:
        os.killpg(process.pid, signal.SIGKILL)
        process.wait()
    except ProcessLookupError:
        pass
