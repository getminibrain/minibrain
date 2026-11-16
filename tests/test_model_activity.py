from typing import Any

from minibrain.registry.models import JobKind
from tests.conftest import Harness
from tests.test_flow import SLUG, add_version, create_with_dataset, finish


def events(harness: Harness) -> list[dict[str, Any]]:
    return harness.client.get(f"/api/models/{SLUG}/activity").json()["events"]


def version_links(harness: Harness, number: int) -> list[dict[str, Any]]:
    return [
        event["link"]
        for event in events(harness)
        if event["link"] and event["link"]["kind"] == "version" and event["link"]["version"] == number
    ]


def test_links_to_a_deleted_version_say_it_was_deleted(harness: Harness) -> None:
    create_with_dataset(harness)
    add_version(harness, "lora")
    finish(harness, JobKind.TRAIN)
    links = version_links(harness, 1)
    assert links and not any(link["deleted"] for link in links)
    deleted = harness.client.delete(f"/api/models/{SLUG}/versions/1", params={"cancel_jobs": True})
    assert deleted.status_code in (202, 204), deleted.text
    harness.settle()
    links = version_links(harness, 1)
    assert links and all(link["deleted"] for link in links)
