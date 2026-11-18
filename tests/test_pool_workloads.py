from typing import Any

from sqlalchemy import select

from minibrain.jobs.queue import enqueue
from minibrain.models.hardware import GIB
from minibrain.registry.models import AuditEvent, JobKind
from minibrain.registry.pool_settings import WorkloadError
from minibrain.registry.service import get_model
from tests.conftest import Harness
from tests.test_deploy_pools import BIG_LAPTOP, LAPTOP, deploy, deployment, join, on_main
from tests.test_flow import SLUG, create_model, create_with_dataset
from tests.test_training_plan import register, worker_hardware


def use(harness: Harness, pool: str, *workloads: str) -> Any:
    return harness.client.put(f"/api/compute/pools/{pool}/settings", json={"workloads": list(workloads)})


def pool_of(harness: Harness, name: str) -> dict[str, Any]:
    return next(pool for pool in harness.client.get("/api/compute/pools").json() if pool["name"] == name)


def placed(harness: Harness, name: str) -> dict[str, Any]:
    placement = harness.client.get(f"/api/models/{SLUG}/placement").json()
    return next(pool for pool in placement["pools"] if pool["name"] == name)


def test_a_pool_is_used_for_anything_until_an_admin_narrows_it(harness: Harness) -> None:
    join(harness, "rack")
    assert pool_of(harness, "rack")["workloads"] == ["serving", "training"]
    assert harness.client.get("/api/compute/pools/rack/settings").json() == {
        "pool": "rack",
        "description": None,
        "workloads": ["serving", "training"],
    }
    saved = use(harness, "rack", "training")
    assert saved.status_code == 200 and saved.json()["workloads"] == ["training"]
    assert pool_of(harness, "rack")["workloads"] == ["training"]
    assert use(harness, "rack", "serving", "training").json()["workloads"] == ["serving", "training"]
    assert pool_of(harness, "rack")["workloads"] == ["serving", "training"]


def test_a_pool_needs_one_known_use(harness: Harness) -> None:
    assert use(harness, "rack").status_code == 422
    assert use(harness, "rack", "batch").status_code == 422


def test_changing_the_use_is_audited_once(harness: Harness) -> None:
    use(harness, "rack", "serving")
    use(harness, "rack", "serving")
    use(harness, "rack", "serving", "training")
    with harness.sessions() as session:
        found = session.scalars(select(AuditEvent).where(AuditEvent.action == "pool.workloads").order_by(AuditEvent.id))
        events = [(event.target, event.detail["from"], event.detail["to"]) for event in found]
    assert events == [
        ("rack", ["serving", "training"], ["serving"]),
        ("rack", ["serving"], ["serving", "training"]),
    ]


def test_deploying_skips_and_refuses_pools_not_used_for_serving(harness: Harness) -> None:
    on_main(harness, LAPTOP)
    join(harness, "rack")
    create_model(harness)
    assert harness.client.get(f"/api/models/{SLUG}/placement").json()["automatic"] == "rack"
    use(harness, "rack", "training")
    rack = placed(harness, "rack")
    assert rack["refused"].startswith("Pool rack is used for training and scoring only, not serving.")
    assert harness.client.get(f"/api/models/{SLUG}/placement").json()["automatic"] is None
    refused = deploy(harness, "rack")
    assert refused.status_code == 422 and refused.json()["detail"] == rack["refused"]
    assert deploy(harness).status_code == 422
    assert deployment(harness)["state"] == "not_deployed"


def test_a_deployment_stays_on_a_pool_that_stops_serving(harness: Harness) -> None:
    on_main(harness, BIG_LAPTOP)
    join(harness, "rack")
    create_model(harness)
    assert deploy(harness, "rack").status_code == 200
    use(harness, "rack", "training")
    assert deploy(harness, "rack", replicas=1).status_code == 200
    assert deployment(harness)["pool"] == "rack"
    moved = deploy(harness, "auto")
    target = harness.client.get(f"/api/models/{SLUG}/placement").json()["pool"]
    assert moved.status_code == 200 and target == "local"
    assert deploy(harness, "rack").status_code == 422


def test_training_jobs_go_only_to_pools_used_for_training(harness: Harness) -> None:
    create_with_dataset(harness)
    register(harness, worker_hardware(24 * GIB, libraries=("bitsandbytes",)))
    register(harness, worker_hardware(48 * GIB, libraries=("bitsandbytes",)), host="gpu-a10-1", pool="gpu-pool")
    use(harness, "gpu-pool", "serving")
    url = f"/api/models/{SLUG}/training-plan"
    found = harness.client.get(url).json()
    assert {machine["pool"] for machine in found["machines"]} == {"local"}
    assert [pool["name"] for pool in found["closed_pools"]] == ["gpu-pool"]
    assert found["closed_pools"][0]["reason"].startswith("Pool gpu-pool is used for serving only")
    assert harness.client.get(url, params={"pool": "gpu-pool"}).status_code == 422
    pinned = harness.client.post(f"/api/models/{SLUG}/versions", json={"kind": "lora", "pool": "gpu-pool"})
    assert pinned.status_code == 422 and "not training and scoring" in pinned.json()["detail"]
    version = harness.client.post(f"/api/models/{SLUG}/versions", json={"kind": "lora"})
    assert version.status_code == 201, version.text
    assert harness.claim(["train", "eval"], worker_id="worker-gpu-a10-1", pool="gpu-pool") is None
    claim = harness.claim(["train"], worker_id="worker-gpu-box")
    assert claim is not None and claim["job_id"] == version.json()["job"]["id"]


def test_other_jobs_still_run_on_a_serving_pool(harness: Harness) -> None:
    create_model(harness)
    use(harness, "rack", "serving")
    with harness.sessions() as session:
        model = get_model(session, SLUG)
        job = enqueue(session, JobKind.VERIFY, {}, model.id, pool="rack")
        session.commit()
        job_id = job.id
        try:
            enqueue(session, JobKind.TRAIN, {}, model.id, pool="rack")
        except WorkloadError as error:
            refused = str(error)
        else:
            refused = ""
    assert refused.startswith("Pool rack is used for serving only, not training and scoring.")
    claim = harness.claim(["verify", "train"], worker_id="w-rack", pool="rack")
    assert claim is not None and claim["job_id"] == job_id


def test_a_job_running_when_the_pool_stops_training_finishes(harness: Harness) -> None:
    create_with_dataset(harness)
    register(harness, worker_hardware(48 * GIB, libraries=("bitsandbytes",)), host="gpu-a10-1", pool="gpu-pool")
    version = harness.client.post(f"/api/models/{SLUG}/versions", json={"kind": "lora", "pool": "gpu-pool"})
    assert version.status_code == 201, version.text
    claim = harness.claim(["train"], worker_id="worker-gpu-a10-1", pool="gpu-pool")
    assert claim is not None
    use(harness, "gpu-pool", "serving")
    body = {"token": claim["token"], "result": {"metrics": {}}, "outputs": {}}
    assert harness.internal(f"/jobs/{claim['job_id']}/complete", body).status_code == 204
