from typing import Any

from tests.conftest import Harness, fake_adapter
from tests.test_aibom import aibom, props
from tests.test_model_card import CARD, complete, scored, trained_card


def started_from_one(harness: Harness) -> dict[str, Any]:
    trained_card(harness)
    response = harness.client.post(CARD, json={"kind": "lora", "max_rows": 120, "from_version": 1})
    assert response.status_code == 201, response.text
    return response.json()


def test_a_run_records_the_version_its_settings_started_from(harness: Harness) -> None:
    created = started_from_one(harness)
    assert created["from_version"] == 1
    listed = {item["number"]: item for item in harness.client.get(CARD).json()}
    assert listed[2]["from_version"] == 1
    assert listed[1]["from_version"] is None
    events = harness.client.get("/api/audit", params={"action": ["version.create"]}).json()["events"]
    assert any(event["detail"].get("from_version") == 1 for event in events)


def test_a_prompt_version_records_where_it_started_too(harness: Harness) -> None:
    trained_card(harness)
    response = harness.client.post(CARD, json={"kind": "prompt", "from_version": 0})
    assert response.status_code == 201, response.text
    assert response.json()["from_version"] == 0


def test_starting_from_a_missing_version_is_refused(harness: Harness) -> None:
    trained_card(harness)
    response = harness.client.post(CARD, json={"kind": "lora", "max_rows": 120, "from_version": 9})
    assert response.status_code == 404
    assert "v9" in response.text
    assert [item["number"] for item in harness.client.get(CARD).json()] == [1, 0]


def test_the_card_and_aibom_name_the_version_a_run_started_from(harness: Harness) -> None:
    started_from_one(harness)
    adapter = harness.upload(fake_adapter(), "adapter", "tar", "adapter")
    complete(harness, "train", {"summary": {"max_rows": 120, "device": "cpu"}}, {"adapter": adapter})
    scored(harness, 2, wrong=4)
    card = harness.client.get(f"{CARD}/2/card").json()["card"]
    assert card["training"]["started_from"] == 1
    assert "| Started from | v1 |" in harness.client.get(f"{CARD}/2/card.md").text
    assert props(aibom(harness, 2)["metadata"]["component"])["minibrain:training:started_from"] == "v1"
    assert harness.client.get(f"{CARD}/1/card").json()["card"]["training"]["started_from"] is None
