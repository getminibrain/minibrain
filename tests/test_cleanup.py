import duckdb
import pytest

from minibrain.data.cleanup import cleaned_sql
from minibrain.data.sources import SourceError
from minibrain.data.templates import cleanup_of, pair_template, template_sql
from tests.conftest import Harness

ROWS = [
    ("same words", "billing"),
    ("same words", "billing"),
    ("same words", "bug"),
    (" other words ", "bug"),
    ("other words", "billing"),
    ("write to jane.doe@example.com please", "account"),
    ("call +44 20 7946 0958 now", "account"),
    ("x" * 40, "account"),
    ("rare one", "rare"),
]


def table_sql() -> str:
    values = ", ".join(f"('{text}', '{label}')" for text, label in ROWS)
    return f"SELECT * FROM (VALUES {values}) AS rows(input, label)"


def cleaned(**steps: str) -> list[tuple[str, str]]:
    with duckdb.connect() as connection:
        found = connection.execute(f"{cleaned_sql(table_sql(), steps)} ORDER BY ALL").fetchall()
    return [(str(text), str(label)) for text, label in found]


def test_no_steps_keep_the_query_as_it_is() -> None:
    assert cleaned_sql("SELECT 1", {}) == "SELECT 1"


def test_conflicts_keep_the_most_common_label_or_drop_the_input() -> None:
    common = cleaned(conflicts="common")
    assert [row for row in common if row[0] == "same words"] == [("same words", "billing")] * 2
    assert [row for row in common if row[0].strip() == "other words"] == [("other words", "billing")]
    dropped = cleaned(conflicts="drop")
    assert not [row for row in dropped if "words" in row[0]]
    assert len(dropped) == 4


def test_personal_data_is_masked_or_dropped() -> None:
    masked = {text for text, _ in cleaned(personal_data="mask")}
    assert "write to [email address] please" in masked
    assert "call [phone number] now" in masked
    assert len(cleaned(personal_data="drop")) == len(ROWS) - 2


def test_long_inputs_rare_labels_and_rows_per_label() -> None:
    assert ("x" * 40, "account") not in cleaned(max_tokens="9")
    assert ("x" * 40, "account") in cleaned(max_tokens="10")
    assert not [row for row in cleaned(rare="2") if row[1] == "rare"]
    capped = cleaned(per_label="1")
    assert sorted(label for _, label in capped) == ["account", "billing", "bug", "rare"]


def test_steps_run_in_a_fixed_order_whatever_order_they_are_given() -> None:
    first = cleaned_sql("SELECT 1", {"per_label": "5", "personal_data": "mask"})
    second = cleaned_sql("SELECT 1", {"personal_data": "mask", "per_label": "5"})
    assert first == second
    assert first.index("regexp_replace") < first.index("row_number")


def test_cleanup_values_are_checked() -> None:
    with pytest.raises(SourceError):
        cleaned_sql("SELECT 1", {"conflicts": "maybe"})
    with pytest.raises(SourceError):
        cleaned_sql("SELECT 1", {"rare": "1"})
    with pytest.raises(SourceError):
        cleaned_sql("SELECT 1", {"max_tokens": "1; DROP TABLE x"})


def test_a_template_compiles_its_cleanup_into_the_query() -> None:
    template = {**pair_template("text", "category"), "conflicts": "drop", "rare": "3"}
    sql = template_sql(template, ["tickets"])
    assert sql.startswith("WITH base AS (SELECT")
    assert "count(DISTINCT trim(CAST(label AS VARCHAR)))" in sql and ">= 3" in sql
    assert cleanup_of(template) == {"conflicts": "drop", "rare": "3"}


def upload(harness: Harness) -> dict:
    lines = ["text,category", *(f"{text.strip()},{label}" for text, label in ROWS)]
    lines += [f"ticket {index},{'billing' if index % 2 else 'bug'}" for index in range(30)]
    data = ("\n".join(lines) + "\n").encode()
    response = harness.client.post("/api/sources", files={"file": ("tickets.csv", data, "text/csv")})
    assert response.status_code == 201, response.text
    return response.json()


def test_picked_columns_save_their_cleanup(harness: Harness) -> None:
    source = upload(harness)
    body = {"name": "Tickets", "source_id": source["id"], "input_column": "text", "label_column": "category"}
    created = harness.client.post("/api/datasets", json=body | {"cleanup": {"conflicts": "drop", "rare": 2}})
    assert created.status_code == 201, created.text
    mapping = created.json()["mapping"]
    assert mapping["cleanup"] == {
        "personal_data": None,
        "max_tokens": None,
        "conflicts": "drop",
        "rare": 2,
        "per_label": None,
    }
    assert (mapping["input_column"], mapping["label_column"]) == ("text", "category")
    version = created.json()["dataset_version"]
    assert version["rows"] == len(ROWS) + 30 - 5 - 1
    cleared = harness.client.put(
        "/api/datasets/tickets/mapping",
        json={"source_id": source["id"], "input_column": "text", "label_column": "category"},
    )
    assert cleared.status_code == 200, cleared.text
    assert cleared.json()["mapping"]["cleanup"]["conflicts"] is None
    refused = harness.client.put(
        "/api/datasets/tickets/mapping",
        json={"source_id": source["id"], "input_column": "text", "label_column": "category", "cleanup": {"rare": 1}},
    )
    assert refused.status_code == 422
