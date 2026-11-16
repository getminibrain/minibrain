from dataclasses import replace
from datetime import timedelta
from typing import Any

from minibrain.models.hardware import GIB, Gpu, NodeReport, fit
from minibrain.registry.models import (
    Artifact,
    BaseModel,
    BaseModelStatus,
    Dataset,
    DatasetVersion,
    EngineReplica,
    Job,
    JobAttempt,
    JobEvent,
    JobKind,
    JobStatus,
    Model,
    Source,
    Version,
    now,
)
from tests.conftest import Harness

RACK = NodeReport(
    host="gpu-01",
    system="linux",
    arch="x86_64",
    cpu_count=64,
    ram_bytes=512 * GIB,
    accelerator="cuda",
    accelerator_name="4 x NVIDIA H100 80GB HBM3 (compute 9.0)",
    usable_bytes=320 * GIB,
    gpus=[Gpu("NVIDIA H100 80GB HBM3", 80 * GIB)] * 4,
    engines=["sglang", "transformers"],
)


def join_rack(harness: Harness) -> None:
    worker = {"id": "w-rack", "host": RACK.host, "kinds": ["train"], "pool": "rack", "hardware": RACK.as_dict()}
    assert harness.internal("/register", worker).status_code == 204


def announce(harness: Harness, **overrides: Any) -> None:
    body = {
        "id": "e-1",
        "host": RACK.host,
        "url": "http://gpu-01:9000",
        "base_model": "qwen3-0.6b",
        "engine": "sglang",
        "state": "ready",
        "pool": "rack",
        "hardware": RACK.as_dict(),
    } | overrides
    response = harness.client.post("/internal/gateway/engines", json=body, headers=harness.gateway_headers)
    assert response.status_code == 204


def by_name(harness: Harness) -> dict[str, dict[str, Any]]:
    return {pool["name"]: pool for pool in harness.client.get("/api/compute/pools").json()}


def test_local_install_is_one_pool_with_this_machine(harness: Harness) -> None:
    pools = harness.client.get("/api/compute/pools").json()
    assert [(pool["name"], pool["label"]) for pool in pools] == [("local", "This machine")]
    main = pools[0]["nodes"][0]
    assert main["roles"] == ["main"] and main["online"] and "transformers" in main["engines"]


def test_workers_and_engines_report_hardware_into_their_pool(harness: Harness) -> None:
    join_rack(harness)
    announce(harness)
    rack = by_name(harness)["rack"]
    node = rack["nodes"][0]
    assert (node["host"], node["accelerator"], len(node["gpus"]), node["roles"]) == (
        "gpu-01",
        "cuda",
        4,
        ["worker", "engine"],
    )
    assert node["usable_bytes"] == 320 * GIB and node["engines"] == ["sglang", "transformers"]
    assert [(e["base_model"], e["engine"], e["state"]) for e in rack["engines"]] == [("qwen3-0.6b", "sglang", "ready")]
    with harness.sessions() as session:
        session.query(EngineReplica).update({"seen_at": now() - timedelta(minutes=5)})
        session.commit()
    assert by_name(harness)["rack"]["engines"] == []


def test_discover_judges_fit_against_the_selected_pool(harness: Harness) -> None:
    join_rack(harness)
    local = harness.client.get("/api/catalog").json()
    assert local["pool"] == "local" and [p["name"] for p in local["pools"]] == ["local", "rack"]
    rack = harness.client.get("/api/catalog", params={"pool": "rack"}).json()
    assert rack["pool"] == "rack" and rack["hardware"]["machine"] == "gpu-01" and rack["hardware"]["gpus"] == 4
    xl = min((e for e in rack["entries"] if e["tier"] == "XL"), key=lambda e: e["variants"][0]["weights_bytes"])
    assert xl["variants"][0]["fit"]["level"] in {"fits", "limited"}
    assert "pool rack (gpu-01) has 320.0 GB GPU memory" in xl["variants"][0]["fit"]["basis"]
    local_xl = next(entry for entry in local["entries"] if entry["id"] == xl["id"])
    assert local_xl["variants"][0]["fit"]["level"] == "insufficient"


def test_multi_gpu_models_need_several_gpus() -> None:
    one = replace(RACK.hardware(), gpus=1)
    requires = {"gpus": "multi", "note": "Needs several datacenter GPUs."}
    assert fit(60 * GIB, requires, one)["basis"] == "Needs several datacenter GPUs."
    assert fit(60 * GIB, requires, RACK.hardware())["level"] == "fits"
    assert NodeReport.from_dict(RACK.as_dict()) == RACK


def test_infrastructure_reports_the_setup_and_where_data_lives(harness: Harness) -> None:
    info = harness.client.get("/api/system/infrastructure").json()
    assert info["setup"] == "one_machine"
    stores = {store["name"]: store for store in info["stores"]}
    assert set(stores) == {"Database", "Model files", "Dataset versions", "Uploads, adapters and results"}
    assert info["dataset_versions"] == {"count": 0, "size": 0, "for_versions": 0, "saved": 0, "keep": 5}
    assert stores["Database"]["kind"] == "sqlite" and stores["Database"]["location"].endswith("minibrain.db")
    assert stores["Model files"]["free_bytes"] > 0 and stores["Model files"]["used_bytes"] == 0
    join_rack(harness)
    assert harness.client.get("/api/system/infrastructure").json()["setup"] == "remote_gpus"


def test_machines_report_versions(harness: Harness) -> None:
    local = by_name(harness)["local"]["nodes"][0]
    assert local["versions"]["minibrain"]
    current = {
        "id": "w-new",
        "host": "gpu-09",
        "kinds": ["train"],
        "pool": "rack",
        "hardware": RACK.as_dict() | {"versions": {"minibrain": "0.0.1"}},
    }
    assert harness.internal("/register", current).status_code == 204
    rack = by_name(harness)["rack"]["nodes"]
    assert [node["versions"] for node in rack] == [{"minibrain": "0.0.1"}]


def serve_on_rack(harness: Harness) -> None:
    with harness.sessions() as session:
        session.add(Artifact(id="adapter-1", kind="adapter", packing="raw", name="adapter", size=64 * 1024**2))
        model = Model(
            slug="triage",
            name="Ticket Triage",
            preset="classify",
            base_model="qwen3-0.6b",
            deployed=True,
            current_version=4,
            pool="rack",
        )
        session.add(model)
        session.flush()
        session.add(
            Version(
                model_id=model.id,
                number=4,
                kind="sft",
                status="ready",
                base_model="qwen3-0.6b",
                adapter_artifact_id="adapter-1",
            )
        )
        session.commit()


def train_on_rack(harness: Harness) -> int:
    with harness.sessions() as session:
        job = Job(
            kind=JobKind.TRAIN,
            status=JobStatus.RUNNING,
            lease_owner="w-rack",
            progress=0.37,
            model_slug="support",
            model_name="Support triage",
            version_number=7,
        )
        session.add(job)
        session.flush()
        plan = {"plan": {"peak_bytes": 9 * GIB}}
        session.add(JobEvent(job_id=job.id, attempt=1, kind="data", name="train.start", data={"recipe": plan}))
        session.commit()
        return job.id


def test_pools_say_what_each_machine_is_doing(harness: Harness) -> None:
    join_rack(harness)
    announce(harness)
    serve_on_rack(harness)
    job_id = train_on_rack(harness)
    rack = by_name(harness)["rack"]
    engine = rack["engines"][0]
    assert engine["serves"] == [
        {"model": "triage", "name": "Ticket Triage", "version": 4, "adapter_bytes": 64 * 1024**2}
    ]
    assert rack["nodes"][0]["jobs"] == [
        {
            "id": job_id,
            "kind": "train",
            "model": "support",
            "model_name": "Support triage",
            "version": 7,
            "progress": 0.37,
            "memory_bytes": 9 * GIB,
        }
    ]
    assert by_name(harness)["local"]["nodes"][0]["jobs"] == []


def test_storage_groups_stores_by_disk_and_lists_the_largest_items(harness: Harness) -> None:
    with harness.sessions() as session:
        session.add(Artifact(id="rows-1", kind="dataset_version", packing="parquet", name="rows", size=300))
        session.add(Artifact(id="rows-2", kind="dataset_version", packing="parquet", name="rows", size=200))
        dataset = Dataset(slug="tickets", name="Tickets")
        session.add(dataset)
        session.flush()
        for number, artifact, size in ((1, "rows-1", 300), (2, "rows-1", 300), (3, "rows-2", 200)):
            session.add(
                DatasetVersion(
                    dataset_id=dataset.id,
                    number=number,
                    hash=f"h{number}",
                    artifact_id=artifact,
                    counts={},
                    labels=[],
                    size=size,
                )
            )
        session.commit()
    info = harness.client.get("/api/system/infrastructure").json()
    disks = {store["disk"] for store in info["stores"] if store["kind"] in ("folder", "sqlite")}
    assert len(disks) == 1 and None not in disks
    assert {"kind": "dataset", "key": "tickets", "name": "Tickets", "size_bytes": 500, "version": None} in info[
        "largest"
    ]
    assert all(store["mount"] for store in info["stores"] if store["kind"] in ("folder", "sqlite"))


def test_storage_lists_adapters_uploads_and_logs_and_what_could_be_freed(harness: Harness) -> None:
    serve_on_rack(harness)
    with harness.sessions() as session:
        for artifact, kind, size in (
            ("upload-1", "source", 900),
            ("orphan-1", "source", 70),
            ("log-1", "log", 40),
            ("rows-x", "dataset_version", 123),
        ):
            session.add(Artifact(id=artifact, kind=kind, packing="raw", name=artifact, size=size))
        session.add(
            Source(name="tickets.csv", filename="tickets.csv", table_name="tickets_csv", artifact_id="upload-1")
        )
        for key, size in (("qwen3-0.6b", 5000), ("spare-1b", 3000)):
            session.add(
                BaseModel(id=key, source="download", name=key, status=BaseModelStatus.AVAILABLE, size_bytes=size)
            )
        session.add(DatasetVersion(hash="hx", artifact_id="rows-x", counts={}, labels=[], size=123))
        job = Job(kind=JobKind.TRAIN, status=JobStatus.SUCCEEDED)
        session.add(job)
        session.flush()
        session.add(JobAttempt(job_id=job.id, number=1, worker="w", log_artifact_id="log-1"))
        session.commit()
        job_id = job.id
    info = harness.client.get("/api/system/infrastructure").json()
    largest = {(item["kind"], item["key"], item["version"]): item["size_bytes"] for item in info["largest"]}
    assert largest[("adapter", "triage", 4)] == 64 * 1024**2
    assert ("upload", "1", None) in largest
    assert largest[("log", str(job_id), None)] == 40
    freed = info["reclaimable"]
    assert [item["key"] for item in freed["unused_models"]] == ["spare-1b"]
    assert (freed["orphan_uploads"], freed["orphan_uploads_bytes"]) == (1, 70)
    assert (freed["dataset_versions"], freed["dataset_versions_bytes"]) == (1, 123)
