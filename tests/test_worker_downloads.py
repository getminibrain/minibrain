from typing import Any

from sqlalchemy import select

from minibrain.registry.models import AuditEvent, JoinToken
from minibrain.worker import LEASE_HEADER, MainClient, Worker
from tests.conftest import Harness, give_data, tickets_csv
from tests.test_flow import SLUG, add_version, create_model, create_with_dataset
from tests.test_worker import FAKE, train_job

OTHER = "other-desk"


def fetch(harness: Harness, pool: str, path: str, lease: str | None = None) -> Any:
    headers = {"Authorization": f"Bearer {harness.join_token(pool)}"}
    headers |= {LEASE_HEADER: lease} if lease is not None else {}
    return harness.client.get(f"/internal/worker{path}", headers=headers)


def other_job(harness: Harness) -> None:
    create_model(harness, "Other Desk")
    give_data(harness, OTHER, tickets_csv(120), "other.csv")
    harness.client.post(f"/api/models/{OTHER}/dataset-versions").raise_for_status()
    created = harness.client.post(f"/api/models/{OTHER}/versions", json={"kind": "prompt", "max_rows": 100})
    assert created.status_code == 201, created.text


def refusals(harness: Harness, pool: str) -> list[dict[str, Any]]:
    with harness.sessions() as session:
        prefix = session.scalars(select(JoinToken.prefix).where(JoinToken.pool == pool)).one()
        found = select(AuditEvent).where(AuditEvent.target == prefix, AuditEvent.action == "join_token.refused")
        return [event.detail for event in session.scalars(found)]


def test_a_worker_downloads_only_what_its_leased_job_needs(harness: Harness) -> None:
    mine = create_with_dataset(harness)["hash"]
    add_version(harness, "prompt")
    other_job(harness)
    gpu = harness.claim(["eval"], "gpu-worker", "gpu")
    rack = harness.claim(["eval"], "rack-worker", "rack")
    assert gpu is not None and rack is not None
    theirs = rack["params"]["dataset_version"]["id"]
    assert gpu["params"]["dataset_version"]["id"] == mine != theirs
    base = gpu["params"]["base_spec"]["key"]
    assert fetch(harness, "gpu", f"/artifacts/{mine}", gpu["token"]).status_code == 200
    assert fetch(harness, "gpu", f"/bases/{base}", gpu["token"]).status_code != 403
    assert fetch(harness, "gpu", f"/bases/{base}/files/config.json", gpu["token"]).status_code != 403
    refused = fetch(harness, "gpu", f"/artifacts/{theirs}", gpu["token"])
    assert refused.status_code == 403 and "jobs it holds" in refused.json()["detail"]
    assert fetch(harness, "gpu", f"/artifacts/{mine}").status_code == 403
    assert fetch(harness, "gpu", f"/bases/{base}").status_code == 403
    assert fetch(harness, "gpu", f"/bases/{base}/stored").status_code == 403
    assert fetch(harness, "rack", f"/artifacts/{mine}", gpu["token"]).status_code == 403
    assert fetch(harness, "rack", f"/artifacts/{theirs}", rack["token"]).status_code == 200
    harness.queue.fail(gpu["job_id"], gpu["token"], "stopped", False, None)
    assert fetch(harness, "gpu", f"/artifacts/{mine}", gpu["token"]).status_code == 403
    local = {"Authorization": f"Bearer {harness.token}"}
    assert harness.client.get(f"/internal/worker/artifacts/{mine}", headers=local).status_code == 200
    gpu_refusals = refusals(harness, "gpu")
    assert len(gpu_refusals) == 1 and gpu_refusals[0]["asked"] == theirs
    assert [detail["asked"] for detail in refusals(harness, "rack")] == [mine]


def test_a_joined_worker_fetches_its_job_inputs_with_the_lease(harness: Harness) -> None:
    create_with_dataset(harness)
    add_version(harness, "lora")
    config = harness.worker_config(["train"])
    config.token, config.pool = harness.join_token("gpu"), "gpu"
    client = MainClient(config, http=harness.client)
    assert Worker(config, client=client, modules=FAKE).run_once()
    assert train_job(harness)["status"] == "succeeded"
    assert LEASE_HEADER not in client.headers
    assert harness.client.get(f"/api/models/{SLUG}/versions").json()[0]["status"] == "evaluating"
