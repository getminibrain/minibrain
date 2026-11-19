import pytest

from minibrain.data.checks import matches
from minibrain.data.cleanup import cleaned_sql
from minibrain.data.sources import SourceError, connect
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


def table_sql(rows: list[tuple[str, str]] = ROWS) -> str:
    values = ", ".join(f"('{text}', '{label}')" for text, label in rows)
    return f"SELECT * FROM (VALUES {values}) AS rows(input, label)"


def cleaned_rows(rows: list[tuple[str, str]], **steps: str) -> list[tuple[str, str]]:
    with connect([]) as connection:
        found = connection.execute(f"{cleaned_sql(table_sql(rows), steps)} ORDER BY ALL").fetchall()
    return [(str(text), str(label)) for text, label in found]


def cleaned(**steps: str) -> list[tuple[str, str]]:
    return cleaned_rows(ROWS, **steps)


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
    assert first.index("personal_data_masked") < first.index("row_number")


def test_cleanup_values_are_checked() -> None:
    with pytest.raises(SourceError):
        cleaned_sql("SELECT 1", {"conflicts": "maybe"})
    with pytest.raises(SourceError):
        cleaned_sql("SELECT 1", {"rare": "1"})
    with pytest.raises(SourceError):
        cleaned_sql("SELECT 1", {"max_tokens": "1; DROP TABLE x"})
    with pytest.raises(SourceError):
        cleaned_sql("SELECT 1", {"max_tokens": "²"})
    with pytest.raises(SourceError):
        cleaned_sql("SELECT 1", {"rare": "٣"})


def test_a_template_compiles_its_cleanup_into_the_query() -> None:
    template = {**pair_template("text", "category"), "conflicts": "drop", "rare": "3"}
    sql = template_sql(template, ["tickets"])
    assert sql.startswith("WITH base AS (\nSELECT")
    assert "count(DISTINCT nullif(trim(CAST(label AS VARCHAR)" in sql and ">= 3" in sql
    assert cleanup_of(template) == {"conflicts": "drop", "rare": "3"}


PERSONAL_ROWS = [
    ("Order 1700000000000 shipped", "order"),
    ("card 4111 1111 1111 1111 was charged", "billing"),
    ("card 4111 1111 1111 1112 is not a real card", "billing"),
    ("IBAN DE89370400440532013000 EUR", "billing"),
    ("call 555 1234 at noon", "account"),
    ("ticket 12345 from 2025-01-15", "order"),
]


def test_personal_data_fixes_act_on_exactly_what_the_check_flags() -> None:
    flagged = {text for text, _ in PERSONAL_ROWS if matches(text)}
    assert flagged == {"card 4111 1111 1111 1111 was charged", "IBAN DE89370400440532013000 EUR"}
    kept = {text for text, _ in cleaned_rows(PERSONAL_ROWS, personal_data="drop")}
    assert kept == {text for text, _ in PERSONAL_ROWS} - flagged
    masked = {text for text, _ in cleaned_rows(PERSONAL_ROWS, personal_data="mask")}
    assert "Order 1700000000000 shipped" in masked and "call 555 1234 at noon" in masked
    assert {"card [card number] was charged", "IBAN [IBAN] EUR"} <= masked


def test_fixes_strip_the_same_whitespace_as_the_checks() -> None:
    rows = [("\tsame words\r\n", "billing\t"), ("same words", "billing"), ("same words", "bug\n"), ("other", "bug")]
    assert cleaned_rows(rows, conflicts="drop") == [("other", "bug")]
    assert sorted(label.strip() for text, label in cleaned_rows(rows, conflicts="common") if "same" in text) == [
        "billing",
        "billing",
    ]


def test_an_empty_label_is_not_a_conflicting_label() -> None:
    rows = [("x", "a"), ("x", ""), ("y", "b")]
    assert cleaned_rows(rows, conflicts="drop") == [("x", ""), ("x", "a"), ("y", "b")]


def test_the_query_may_end_in_a_line_comment() -> None:
    with connect([]) as connection:
        found = connection.execute(cleaned_sql(f"{table_sql()} -- the tickets", {"rare": "2"})).fetchall()
    assert len(found) == len(ROWS) - 1


def test_column_names_with_braces_compile_to_quoted_columns() -> None:
    template = pair_template("text}x", "{category")
    assert template_sql(template, ["tickets"]) == (
        'SELECT CAST("text}x" AS VARCHAR) AS input, CAST("{category" AS VARCHAR) AS label FROM tickets'
    )


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
