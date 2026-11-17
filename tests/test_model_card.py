import hashlib
import json
from typing import Any

import pytest
from sqlalchemy import select

from minibrain.registry.models import Model, Version, VersionStatus
from minibrain.tasks.contracts import label_set
from minibrain.tasks.examples import Example, single
from minibrain.tasks.graders import LabelAccuracy, grade
from tests.conftest import LABELS, Harness, fake_adapter, scored_answers
from tests.test_flow import SLUG, TIMING, create_on_data, store_metrics

CARD = f"/api/models/{SLUG}/versions"


def examples(count: int) -> list[Example]:
    return [single(f"held out {index}", LABELS[index % 4]) for index in range(count)]


def score(rows: list[Example], outputs: list[str]) -> dict[str, Any]:
    return grade([LabelAccuracy(LABELS)], label_set(LABELS), rows, outputs)


def answers(rows: list[Example], wrong: int) -> list[str]:
    outputs = [row.expected for row in rows]
    for index in range(wrong):
        outputs[index * 4] = "bug" if index % 3 else "not a label"
    return outputs


def metrics(wrong: int) -> dict[str, Any]:
    held = examples(30)
    golden = examples(20)
    return {
        "golden": score(golden, answers(golden, wrong // 2)),
        "eval": score(held, answers(held, wrong)),
        "latency": {"p50_ms": 41.25, "p95_ms": 80.5},
        "prompt_tokens": 48,
        "device": "cpu",
    }


def complete(harness: Harness, kind: str, result: dict[str, Any], outputs: dict[str, str] | None = None) -> None:
    claim = harness.claim([kind])
    assert claim is not None, f"no {kind} job queued"
    if kind == "eval":
        result = {"metrics": TIMING, "answers": scored_answers(harness, claim["job_id"], 1.0)}
    body = {"token": claim["token"], "result": result, "outputs": outputs or {}}
    assert harness.internal(f"/jobs/{claim['job_id']}/complete", body).status_code == 204


def scored(harness: Harness, number: int, wrong: int) -> None:
    complete(harness, "eval", {})
    store_metrics(harness, SLUG, number, metrics(wrong))


def trained_card(harness: Harness) -> dict[str, Any]:
    create_on_data(harness)
    scored(harness, 0, wrong=6)
    assert harness.client.post(f"{CARD}/0/promote").status_code == 200
    assert harness.client.post(CARD, json={"kind": "lora", "max_rows": 120, "epochs": 2}).status_code == 201
    summary = {"max_rows": 120, "epochs": 2.0, "rank": 16, "alpha": 32, "learning_rate": 2e-4, "micro_batch": 8}
    summary |= {"grad_accum": 2, "seq_len": 64, "strategy": "lora", "plan": {"label": "LoRA fp32"}}
    summary |= {"device": "cpu", "examples": 120, "train_seconds": 9.5, "train_loss": 0.43219}
    adapter = harness.upload(fake_adapter(), "adapter", "tar", "adapter")
    complete(harness, "train", {"summary": summary}, {"adapter": adapter})
    scored(harness, 1, wrong=5)
    assert harness.client.post(f"{CARD}/1/promote").status_code == 200
    response = harness.client.get(f"{CARD}/1/card")
    assert response.status_code == 200, response.text
    return response.json()


def test_card_is_built_from_the_stored_version_its_data_and_scores(harness: Harness) -> None:
    exported = trained_card(harness)
    card = exported["card"]
    assert (card["schema_name"], card["schema_version"]) == ("minibrain.model_card", 1)
    assert card["version"] | {"created_at": None} == {
        "id": f"{SLUG}@1",
        "slug": SLUG,
        "name": "Support Triage",
        "number": 1,
        "kind": "lora",
        "status": "ready",
        "state": "live",
        "created_at": None,
        "created_by": "admin@example.com",
        "note": "",
    }
    assert card["purpose"] == {"description": "", "task": "classify", "labels": sorted(LABELS)}
    base = card["base_model"]
    assert (base["key"], base["repo"], base["licence_use"]) == ("qwen3-0.6b", "Qwen/Qwen3-0.6B", "commercial")
    assert base["licence_name"] == "Apache 2.0"
    data = card["training_data"]
    assert (data["dataset_slug"], data["dataset_version_rows"]) == (SLUG, 200)
    assert data["splits"] == {"train": 146, "held_out": 30, "test": 20, "few_shot": 4}
    assert [row["rows"] for row in data["label_balance"]] == [50, 50, 50, 50]
    assert sum(row["train"] for row in data["label_balance"]) == 146
    assert [(source["table"], source["kind"]) for source in data["sources"]] == [("tickets", "upload")]
    assert len(data["sources"][0]["fingerprint"]) == 64
    assert {check["check"] for check in data["checks"]} >= {"duplicates", "personal_data", "leakage"}
    assert data["personal_data"]["status"] == "ok"
    training = card["training"]
    assert training["recipe"] == {
        "strategy": "LoRA fp32",
        "max_rows": 120,
        "epochs": 2.0,
        "micro_batch": 8,
        "grad_accum": 2,
        "seq_len": 64,
        "rank": 16,
        "alpha": 32,
        "learning_rate": 0.0002,
        "warmup": 0.05,
        "scheduler": "cosine",
        "dropout": 0.05,
        "weight_decay": 0.0,
    }
    assert (training["examples"], training["train_loss"]) == (120, 0.4322)
    assert (training["run"]["machine"], training["run"]["device"]) == ("test", "cpu")
    evaluation = card["evaluation"]
    assert evaluation["held_out"] == pytest.approx(
        {"examples": 30, "accuracy": 25 / 30, "macro_f1": 0.84688995215311, "invalid_rate": 2 / 30}
    )
    bug = next(item for item in evaluation["per_label"] if item["label"] == "bug")
    assert (bug["support"], bug["predicted"], bug["correct"], bug["precision"]) == (8, 11, 8, pytest.approx(8 / 11))
    assert evaluation["confusion"] == [
        {"expected": "billing", "predicted": "bug", "count": 3},
        {"expected": "billing", "predicted": None, "count": 2},
    ]
    prompt_only = evaluation["prompt_only"]
    assert (prompt_only["number"], prompt_only["same_data"], prompt_only["accuracy_change"]) == (
        0,
        True,
        pytest.approx(1 / 30),
    )
    assert evaluation["previous"]["number"] == 0
    kinds = [limit["kind"] for limit in card["limits"]["derived"]]
    assert kinds == ["low_recall", "invalid_outputs", "small_held_out"]
    assert card["limits"]["derived"][0] == {
        "kind": "low_recall",
        "text": "Held-out recall is below 50% for billing (3 of 8).",
        "labels": ["billing"],
    }
    assert card["use"] == {"intended_use": "", "owner": "admin@example.com"}
    assert [(event["actor"], event["summary"]) for event in card["approvals"]] == [
        ("admin@example.com", "Deployed v1, replacing v0")
    ]
    zero = harness.client.get(f"{CARD}/0/card").json()["card"]
    assert [event["kind"] for event in zero["deployments"]] == ["deployed", "replaced"]
    assert zero["evaluation"]["prompt_only"] is None
    assert zero["training"]["few_shot_examples"] == 4


def test_json_export_is_deterministic_and_carries_the_canonical_hash(harness: Harness) -> None:
    exported = trained_card(harness)
    first = harness.client.get(f"{CARD}/1/card.json")
    second = harness.client.get(f"{CARD}/1/card.json")
    assert first.content == second.content
    assert first.headers["content-disposition"] == f'attachment; filename="{SLUG}-v1-model-card.json"'
    envelope = first.json()
    canonical = json.dumps(envelope["card"], sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    assert hashlib.sha256(canonical.encode()).hexdigest() == envelope["sha256"] == exported["sha256"]
    assert envelope["card"]["training"]["recipe"]["epochs"] == 2
    harness.client.post(f"/api/models/{SLUG}/deploy", json={"deployed": False})
    after = harness.client.get(f"{CARD}/1/card.json").json()
    assert after["sha256"] != envelope["sha256"]
    assert after["card"]["deployments"][-1]["summary"] == "Undeployed v1"


def test_markdown_export_renders_every_section_and_the_hash(harness: Harness) -> None:
    exported = trained_card(harness)
    response = harness.client.get(f"{CARD}/1/card.md")
    assert response.headers["content-type"].startswith("text/markdown")
    assert response.headers["content-disposition"] == f'attachment; filename="{SLUG}-v1-model-card.md"'
    text = response.text
    assert text.startswith("# Model card: Support Triage v1\n")
    for heading in ("Purpose", "Intended use and owner", "Base model", "Training data", "Training", "Evaluation"):
        assert f"\n## {heading}\n" in text
    for heading in ("Limits", "Approvals", "Deployment history", "Integrity"):
        assert f"\n## {heading}\n" in text
    assert "| bug | 8 | 11 | 72.7% | 100.0% | 0.842 |" in text
    assert "| Held-out accuracy | 83.3% | 80.0% |" in text
    assert "| Change | \N{EN DASH} | +3.3 pts |" in text
    assert "| Warmup | 5.0% of steps |" in text
    assert "| Schedule | Cosine |" in text
    assert "| LoRA dropout | 0.05 |" in text
    assert "| Weight decay | 0.0 |" in text
    assert f"`{exported['sha256']}`" in text
    assert text == harness.client.get(f"{CARD}/1/card.md").text


def test_a_free_text_card_names_its_metric_and_records_no_macro_f1(harness: Harness) -> None:
    dataset = create_on_data(harness)["dataset"]
    created = harness.client.post("/api/models", json={"name": "Writer", "preset": "general", "dataset": dataset})
    assert created.status_code == 201, created.text
    complete(harness, "eval", {})
    complete(harness, "eval", {})
    path = "/api/models/writer/versions/0"
    evaluation = harness.client.get(f"{path}/card").json()["card"]["evaluation"]
    assert evaluation["metric"] == "text_similarity"
    assert evaluation["held_out"]["macro_f1"] is None
    text = harness.client.get(f"{path}/card.md").text
    assert "| Held-out text similarity |" in text
    assert "Held-out accuracy" not in text
    bom = harness.client.get(f"{path}/aibom.json").json()
    analysis = bom["metadata"]["component"]["modelCard"]["quantitativeAnalysis"]["performanceMetrics"]
    kinds = {item["type"] for item in analysis}
    assert "text-similarity" in kinds and "accuracy" not in kinds and "macro-f1" not in kinds


def test_edits_are_stored_per_version_and_audited(harness: Harness) -> None:
    before = trained_card(harness)
    body = {"intended_use": "  Route support tickets to a queue.  ", "known_limits": "English tickets only."}
    edited = harness.client.put(f"{CARD}/1/card", json=body).json()
    assert edited["card"]["use"]["intended_use"] == "Route support tickets to a queue."
    assert edited["card"]["limits"]["known_limits"] == "English tickets only."
    assert edited["sha256"] != before["sha256"]
    assert harness.client.get(f"{CARD}/0/card").json()["card"]["use"]["intended_use"] == ""
    harness.client.put(f"{CARD}/1/card", json={"known_limits": "English tickets only."})
    harness.client.put(f"{CARD}/1/card", json={"known_limits": ""})
    events = harness.client.get("/api/audit", params={"action": ["version.card"]}).json()["events"]
    assert [(event["target"], event["detail"]["to"]) for event in reversed(events)] == [
        (f"{SLUG}@1", {"intended_use": "Route support tickets to a queue.", "known_limits": "English tickets only."}),
        (f"{SLUG}@1", {"known_limits": ""}),
    ]
    assert events[0]["detail"]["from"] == {"known_limits": "English tickets only."}
    assert harness.client.get(f"{CARD}/1/card").json()["card"]["limits"]["known_limits"] == ""
    too_long = harness.client.put(f"{CARD}/1/card", json={"intended_use": "x" * 2001})
    assert too_long.status_code == 422


def test_a_version_note_is_one_line_audited_and_on_the_card(harness: Harness) -> None:
    before = trained_card(harness)
    saved = harness.client.put(f"{CARD}/1/note", json={"note": "  Added 400 refund\n tickets  "})
    assert saved.status_code == 200, saved.text
    assert saved.json()["note"] == "Added 400 refund tickets"
    assert harness.client.put(f"{CARD}/1/note", json={"note": "Added 400 refund tickets"}).status_code == 200
    listed = {item["number"]: item["note"] for item in harness.client.get(CARD).json()}
    assert listed == {1: "Added 400 refund tickets", 0: None}
    exported = harness.client.get(f"{CARD}/1/card").json()
    assert exported["card"]["version"]["note"] == "Added 400 refund tickets"
    assert exported["sha256"] != before["sha256"]
    assert "\nWhy this version exists: Added 400 refund tickets\n" in harness.client.get(f"{CARD}/1/card.md").text
    bom = harness.client.get(f"{CARD}/1/aibom.json").json()
    properties = {item["name"]: item["value"] for item in bom["metadata"]["component"]["properties"]}
    assert properties["minibrain:version:note"] == "Added 400 refund tickets"
    assert harness.client.put(f"{CARD}/1/note", json={"note": ""}).json()["note"] is None
    events = harness.client.get("/api/audit", params={"action": ["version.note"]}).json()["events"]
    assert [(event["target"], event["detail"]["from"], event["detail"]["to"]) for event in reversed(events)] == [
        (f"{SLUG}@1", "", "Added 400 refund tickets"),
        (f"{SLUG}@1", "Added 400 refund tickets", ""),
    ]
    assert harness.client.put(f"{CARD}/1/note", json={"note": "x" * 201}).status_code == 422
    assert harness.client.put(f"{CARD}/9/note", json={"note": "Missing"}).status_code == 404


def without_data(harness: Harness, number: int) -> None:
    with harness.sessions() as session:
        version = session.scalar(select(Version).join(Model).where(Model.slug == SLUG, Version.number == number))
        assert version is not None
        version.dataset_version_id = None
        version.metrics = None
        version.status = VersionStatus.READY
        session.commit()


def test_a_version_without_data_gets_a_partial_card(harness: Harness) -> None:
    trained_card(harness)
    assert harness.client.post(CARD, json={"kind": "prompt"}).status_code == 201
    without_data(harness, 2)
    response = harness.client.get(f"{CARD}/2/card")
    assert response.status_code == 200, response.text
    card = response.json()["card"]
    assert card["training_data"] is None
    assert card["version"]["state"] == "not_deployed"
    assert card["evaluation"]["scored"] is False
    assert card["purpose"]["labels"] == sorted(LABELS)
    unscored = "Nothing on this card is measured yet: the version has no data yet."
    assert card["limits"]["derived"] == [{"kind": "not_scored", "text": unscored, "labels": []}]
    text = harness.client.get(f"{CARD}/2/card.md").text
    assert "\n## Training data\n\nNo data yet: this version has no dataset version" in text
    assert "· Not deployed ·" in text
    assert "Not scored yet: no data yet." in text
    envelope = harness.client.get(f"{CARD}/2/card.json").json()
    assert envelope["card"]["training_data"] is None
    assert envelope["sha256"] == response.json()["sha256"]
    bom = harness.client.get(f"{CARD}/2/aibom.json").json()
    assert [component["type"] for component in bom["components"]] == ["machine-learning-model"]
    properties = {item["name"]: item["value"] for item in bom["metadata"]["component"]["properties"]}
    assert properties["minibrain:training_data"] == "not available: no data yet"
    assert all("dataset-version" not in ref for item in bom["dependencies"] for ref in item["dependsOn"])


def test_the_card_states_where_the_version_stands_in_product_words(harness: Harness) -> None:
    trained_card(harness)
    states = {n: harness.client.get(f"{CARD}/{n}/card").json()["card"]["version"]["state"] for n in (0, 1)}
    assert states == {0: "not_deployed", 1: "live"}
    text = harness.client.get(f"{CARD}/1/card.md").text
    assert "· Live ·" in text
    assert "promot" not in text.lower()
