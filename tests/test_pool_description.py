from typing import Any

from sqlalchemy import select

from minibrain.auth.roles import Role
from minibrain.registry.models import AuditEvent, PoolSetting
from minibrain.registry.pool_settings import DESCRIPTION_LIMIT
from tests.conftest import Harness
from tests.test_deploy_pools import LAPTOP, join, on_main
from tests.test_flow import SLUG, create_model, create_with_dataset
from tests.test_pool_workloads import pool_of, use
from tests.test_training_plan import register, worker_hardware

SETTINGS = "/api/compute/pools/{}/settings"
RACK = "Production serving · H100, rack 4"


def describe(harness: Harness, pool: str, description: str | None, **more: Any) -> Any:
    return harness.client.put(SETTINGS.format(pool), json={"description": description, **more})


def described_events(harness: Harness) -> list[tuple[str, str | None, str | None]]:
    with harness.sessions() as session:
        query = select(AuditEvent).where(AuditEvent.action == "pool.description").order_by(AuditEvent.id)
        return [(event.target, event.detail["from"], event.detail["to"]) for event in session.scalars(query)]


def test_a_pool_has_no_description_until_an_admin_writes_one(harness: Harness) -> None:
    join(harness, "rack")
    assert pool_of(harness, "rack")["description"] is None
    saved = describe(harness, "rack", RACK)
    assert saved.status_code == 200
    assert saved.json() == {"pool": "rack", "description": RACK, "workloads": ["serving", "training"]}
    assert harness.client.get(SETTINGS.format("rack")).json()["description"] == RACK
    assert pool_of(harness, "rack")["description"] == RACK


def test_the_description_is_trimmed_to_one_line(harness: Harness) -> None:
    saved = describe(harness, "rack", "  Production   serving\n  H100  ")
    assert saved.json()["description"] == "Production serving H100"


def test_the_description_has_a_length_limit_after_trimming(harness: Harness) -> None:
    longest = "x" * DESCRIPTION_LIMIT
    assert describe(harness, "rack", f"  {longest}  ").json()["description"] == longest
    refused = describe(harness, "rack", longest + "y")
    assert refused.status_code == 422
    assert harness.client.get(SETTINGS.format("rack")).json()["description"] == longest


def test_an_empty_description_clears_it_and_leaves_no_settings_behind(harness: Harness) -> None:
    describe(harness, "rack", RACK)
    assert describe(harness, "rack", "   ").json()["description"] is None
    describe(harness, "rack", RACK)
    assert describe(harness, "rack", None).json()["description"] is None
    with harness.sessions() as session:
        assert session.get(PoolSetting, "rack") is None


def test_use_and_description_change_apart(harness: Harness) -> None:
    describe(harness, "rack", RACK)
    assert use(harness, "rack", "serving").json() == {"pool": "rack", "description": RACK, "workloads": ["serving"]}
    assert use(harness, "rack", "serving", "training").json()["description"] == RACK
    cleared = describe(harness, "rack", "")
    assert cleared.json() == {"pool": "rack", "description": None, "workloads": ["serving", "training"]}
    both = describe(harness, "rack", RACK, workloads=["training"])
    assert both.json() == {"pool": "rack", "description": RACK, "workloads": ["training"]}


def test_only_admins_change_or_read_pool_settings(harness: Harness) -> None:
    for role in (Role.VIEWER, Role.BUILDER):
        client = harness.person(role)
        assert client.put(SETTINGS.format("rack"), json={"description": RACK}).status_code == 403
        assert client.get(SETTINGS.format("rack")).status_code == 403
    assert harness.client.get(SETTINGS.format("rack")).json()["description"] is None


def test_changing_the_description_is_audited_once(harness: Harness) -> None:
    describe(harness, "rack", RACK)
    describe(harness, "rack", f" {RACK} ")
    use(harness, "rack", "serving")
    describe(harness, "rack", "Spare")
    describe(harness, "rack", "")
    assert described_events(harness) == [
        ("rack", None, RACK),
        ("rack", RACK, "Spare"),
        ("rack", "Spare", None),
    ]


def test_pool_pickers_carry_the_description(harness: Harness) -> None:
    on_main(harness, LAPTOP)
    join(harness, "rack")
    create_model(harness)
    describe(harness, "rack", RACK)
    placement = harness.client.get(f"/api/models/{SLUG}/placement").json()
    found = {pool["name"]: pool["description"] for pool in placement["pools"]}
    assert found == {"local": None, "rack": RACK}
    catalog = harness.client.get("/api/catalog", params={"pool": "rack"}).json()
    assert {pool["name"]: pool["description"] for pool in catalog["pools"]}["rack"] == RACK


def test_the_training_plan_carries_the_description(harness: Harness) -> None:
    create_with_dataset(harness)
    register(harness, worker_hardware(48 * 1024**3, libraries=("bitsandbytes",)), host="gpu-a10-1", pool="gpu-pool")
    describe(harness, "gpu-pool", "Training rig")
    url = f"/api/models/{SLUG}/training-plan"
    machines = harness.client.get(url).json()["machines"]
    assert {machine["pool"]: machine["pool_description"] for machine in machines}["gpu-pool"] == "Training rig"
    use(harness, "gpu-pool", "serving")
    closed = harness.client.get(url).json()["closed_pools"]
    assert [(pool["name"], pool["description"]) for pool in closed] == [("gpu-pool", "Training rig")]
