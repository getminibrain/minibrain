from collections.abc import Callable, Mapping

from minibrain.data.checks import CHARS_PER_TOKEN
from minibrain.data.sources import SourceError

CONFLICTS = "conflicts"
PER_LABEL = "per_label"
RARE = "rare"
MAX_TOKENS = "max_tokens"
PERSONAL_DATA = "personal_data"
CLEANUP_KEYS = (PERSONAL_DATA, MAX_TOKENS, CONFLICTS, RARE, PER_LABEL)
CHOICES = {CONFLICTS: ("common", "drop"), PERSONAL_DATA: ("mask", "drop")}
NUMBERS = {MAX_TOKENS: (1, 1_000_000), RARE: (2, 100_000), PER_LABEL: (1, 50_000_000)}

TEXT = "CAST(input AS VARCHAR)"
INPUT = f"trim({TEXT})"
LABEL = "trim(CAST(label AS VARCHAR))"

PERSONAL_PATTERNS = (
    ("email address", r"[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}"),
    ("IBAN", r"\b[A-Z]{2}\d{2}( ?[A-Z0-9]){11,30}\b"),
    ("card number", r"\b\d([ -]?\d){12,18}\b"),
    (
        "phone number",
        r"\+\d{1,3}[\s.-]?(\(\d{1,4}\)[\s.-]?)?\d{2,4}([\s.-]\d{2,4}){1,4}\b"
        r"|\(\d{1,4}\)[\s.-]?\d{3,4}[\s.-]\d{3,4}\b"
        r"|\b\d{3,4}[\s.-]\d{3,4}[\s.-]\d{3,4}\b",
    ),
)

Cleanup = Mapping[str, str]


def masked_input() -> str:
    text = TEXT
    for name, pattern in PERSONAL_PATTERNS:
        text = f"regexp_replace({text}, '{pattern}', '[{name}]', 'g')"
    return text


def personal_match() -> str:
    return " OR ".join(f"regexp_matches({TEXT}, '{pattern}')" for _, pattern in PERSONAL_PATTERNS)


def personal_step(choice: str) -> Callable[[str], str]:
    if choice == "mask":
        return lambda table: f"SELECT * REPLACE ({masked_input()} AS input) FROM {table}"
    return lambda table: f"SELECT * FROM {table} WHERE input IS NULL OR NOT ({personal_match()})"


def long_step(tokens: int) -> Callable[[str], str]:
    return lambda table: f"SELECT * FROM {table} WHERE coalesce(length({INPUT}), 0) <= {tokens} * {CHARS_PER_TOKEN}"


def conflicts_step(choice: str) -> Callable[[str], str]:
    if choice == "drop":
        return lambda table: f"SELECT * FROM {table} QUALIFY count(DISTINCT {LABEL}) OVER (PARTITION BY {INPUT}) <= 1"
    return lambda table: (
        f"SELECT * EXCLUDE (_label_rows) FROM (SELECT *, count(*) OVER (PARTITION BY {INPUT}, {LABEL}) "
        f"AS _label_rows FROM {table}) QUALIFY dense_rank() OVER (PARTITION BY {INPUT} "
        f"ORDER BY coalesce({LABEL}, '') = '', _label_rows DESC, {LABEL}) = 1"
    )


def rare_step(rows: int) -> Callable[[str], str]:
    return lambda table: f"SELECT * FROM {table} QUALIFY count(*) OVER (PARTITION BY {LABEL}) >= {rows}"


def per_label_step(rows: int) -> Callable[[str], str]:
    return lambda table: (
        f"SELECT * FROM {table} QUALIFY row_number() OVER (PARTITION BY {LABEL} ORDER BY hash(input), input) <= {rows}"
    )


def number(cleanup: Cleanup, key: str) -> int:
    low, high = NUMBERS[key]
    text = cleanup[key]
    if not text.isdigit() or not low <= int(text) <= high:
        raise SourceError(f"{key} takes a whole number from {low:,} to {high:,}")
    return int(text)


def checked_cleanup(cleanup: Cleanup) -> dict[str, str]:
    found: dict[str, str] = {}
    for key in CLEANUP_KEYS:
        if key not in cleanup:
            continue
        if key in CHOICES and cleanup[key] not in CHOICES[key]:
            raise SourceError(f"{key} is one of {', '.join(CHOICES[key])}")
        found[key] = str(number(cleanup, key)) if key in NUMBERS else cleanup[key]
    return found


def steps_of(cleanup: Cleanup) -> list[Callable[[str], str]]:
    found = checked_cleanup(cleanup)
    builders: dict[str, Callable[[str], Callable[[str], str]]] = {
        PERSONAL_DATA: personal_step,
        MAX_TOKENS: lambda value: long_step(int(value)),
        CONFLICTS: conflicts_step,
        RARE: lambda value: rare_step(int(value)),
        PER_LABEL: lambda value: per_label_step(int(value)),
    }
    return [builders[key](found[key]) for key in CLEANUP_KEYS if key in found]


def cleaned_sql(sql: str, cleanup: Cleanup) -> str:
    steps = steps_of(cleanup)
    if not steps:
        return sql
    names = ["base", *(f"step_{index}" for index in range(1, len(steps) + 1))]
    parts = [f"base AS ({sql})"]
    parts += [f"{names[index + 1]} AS ({step(names[index])})" for index, step in enumerate(steps)]
    return f"WITH {', '.join(parts)} SELECT * FROM {names[-1]}"
