from typing import Any

from minibrain.registry.models import JobKind
from tests.conftest import Harness
from tests.test_flow import SLUG, add_version, create_on_data, create_with_dataset, finish


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


def test_v0_is_queued_for_scoring_until_its_scoring_finishes(harness: Harness) -> None:
    create_on_data(harness)
    texts = [event["text"] for event in events(harness)]
    assert "queued v0 for scoring, prompt only" in texts
    assert not [text for text in texts if text.startswith("scored")]
    finish(harness, JobKind.EVAL, accuracy=1.0)
    found = events(harness)
    texts = [event["text"] for event in found]
    assert "scored v0" in texts and "queued v0 for scoring, prompt only" not in texts
    scored = next(event for event in found if event["text"] == "scored v0")
    assert scored["action"] == "version.scored" and scored["score"] is not None
