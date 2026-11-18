import hashlib
import json
import re
from collections import Counter, defaultdict
from collections.abc import Callable, Sequence
from dataclasses import asdict, dataclass

from minibrain.data.splits import MIN_ROWS, STEADY_ROWS
from minibrain.tasks.examples import Example

CHECKS = ("duplicates", "conflicts", "balance", "leakage", "length", "personal_data")
QUICK_CHECKS = ("duplicates", "conflicts", "balance", "length", "personal_data")
HARD_STOPS = ("empty", "single_label")
LONG_TOKENS = 2048
CHARS_PER_TOKEN = 4
EXAMPLES = 5
TABLE_ROWS = 8
QUICK_TEXT_CHARS = 10_000_000

Rows = Sequence[tuple[str | None, str | None]]


@dataclass(frozen=True)
class CheckLimits:
    off: tuple[str, ...] = ()
    majority_share: float = 0.9
    min_label_rows: int = 10


@dataclass(frozen=True)
class Finding:
    check: str
    status: str
    title: str
    detail: str
    count: int = 0
    examples: tuple[str, ...] = ()
    rows: int = 0
    handled: bool = False
    columns: tuple[str, ...] = ()
    table: tuple[tuple[str, ...], ...] = ()

    @property
    def signature(self) -> str:
        payload = json.dumps([self.check, self.status, self.count, list(self.examples)])
        return hashlib.sha256(payload.encode(), usedforsecurity=False).hexdigest()[:16]

    def as_dict(self) -> dict[str, object]:
        return asdict(self) | {
            "examples": list(self.examples),
            "columns": list(self.columns),
            "table": [list(row) for row in self.table],
            "signature": self.signature,
        }


def clip(text: str, limit: int = 120) -> str:
    flat = " ".join(text.split())
    return flat if len(flat) <= limit else f"{flat[: limit - 1]}…"


def usable(rows: Rows) -> list[tuple[str, str]]:
    return [(text.strip(), label.strip()) for text, label in rows if text and label and text.strip() and label.strip()]


def normalized(text: str) -> str:
    return " ".join(re.sub(r"[^\w\s]", " ", text.lower()).split())


def sentence(text: str) -> str:
    return text[:1].upper() + text[1:]


def plural(count: int, noun: str) -> str:
    return f"{count:,} {noun}{'' if count == 1 else 's'}"


def agree(count: int, one: str, many: str) -> str:
    return one if count == 1 else many


def rows_to_train_on(rows: list[tuple[str, str]], examples: int) -> Finding:
    if not rows:
        return Finding(
            "empty",
            "blocked",
            "No rows to train on",
            "No row has both an input and an answer. Check the query's input and label columns, or its messages.",
        )
    if examples < MIN_ROWS:
        return Finding(
            "empty",
            "blocked",
            "Too few rows to train on",
            f"{plural(examples, 'row')} {agree(examples, 'is', 'are')} left after removing empty and repeated "
            f"inputs; training and scoring need at least {MIN_ROWS:,}.",
            count=examples,
        )
    if examples < STEADY_ROWS:
        return Finding(
            "empty",
            "warning",
            "Few rows to train on",
            f"{plural(examples, 'row')} with an input and an answer. Training works, but scores on so few "
            f"held-out rows are rough; {STEADY_ROWS:,} or more give steadier scores.",
            count=examples,
        )
    return Finding("empty", "ok", "Rows to train on", f"{plural(examples, 'row')} with an input and an answer.")


def hard_stops(rows: list[tuple[str, str]], labelled: bool, examples: int) -> list[Finding]:
    labels = Counter(label for _, label in rows)
    empty = rows_to_train_on(rows, examples)
    if not labelled:
        return [empty]
    single = Finding("single_label", "ok", "More than one label", f"{plural(len(labels), 'label')}.")
    if len(labels) == 1:
        only = next(iter(labels))
        single = Finding(
            "single_label",
            "blocked",
            "Only one label",
            f"Every row has the label {only!r}; a model needs at least two labels to learn a choice.",
            count=1,
            examples=(only,),
        )
    return [empty, single]


def duplicates(rows: list[tuple[str, str]], _limits: CheckLimits, _splits: object) -> Finding:
    counts = Counter(text for text, _ in rows)
    repeated = [(text, times) for text, times in counts.most_common() if times > 1]
    extra = sum(times - 1 for _, times in repeated)
    if not repeated:
        return Finding("duplicates", "ok", "No repeated inputs", "Every input appears once.")
    return Finding(
        "duplicates",
        "warning",
        "Repeated inputs",
        f"{plural(extra, 'row')} {agree(extra, 'repeats', 'repeat')} an earlier input; "
        "training keeps the first of each.",
        count=extra,
        examples=tuple(f"{clip(text)} (x{times})" for text, times in repeated[:EXAMPLES]),
        rows=sum(times for _, times in repeated),
        handled=True,
        columns=("Input", "Rows"),
        table=tuple((clip(text), f"{times:,}") for text, times in repeated[:TABLE_ROWS]),
    )


def conflicts(rows: list[tuple[str, str]], _limits: CheckLimits, _splits: object) -> Finding:
    labels: dict[str, set[str]] = defaultdict(set)
    for text, label in rows:
        labels[text].add(label)
    clashing = [(text, sorted(found)) for text, found in labels.items() if len(found) > 1]
    if not clashing:
        return Finding("conflicts", "ok", "No conflicting labels", "Repeated inputs always carry the same label.")
    clashed = {text for text, _ in clashing}
    listed = sorted(clashing)
    return Finding(
        "conflicts",
        "warning",
        "Same input, different labels",
        f"{plural(len(clashing), 'input')} {agree(len(clashing), 'carries', 'carry')} more than one label, "
        "which teaches a model to guess.",
        count=len(clashing),
        examples=tuple(f"{clip(text)} → {', '.join(found)}" for text, found in listed[:EXAMPLES]),
        rows=sum(1 for text, _ in rows if text in clashed),
        columns=("Input", "Labels"),
        table=tuple((clip(text), ", ".join(found)) for text, found in listed[:TABLE_ROWS]),
    )


def balance(rows: list[tuple[str, str]], limits: CheckLimits, _splits: object, labelled: bool = True) -> Finding:
    if not labelled:
        return Finding("balance", "skipped", "Label balance", "Not checked: the answers are not a set of labels.")
    counts = Counter(label for _, label in rows)
    if not counts:
        return Finding("balance", "ok", "Label balance", "No labels yet.")
    top, top_rows = counts.most_common(1)[0]
    share = top_rows / sum(counts.values())
    rare = sorted((label, size) for label, size in counts.items() if size < limits.min_label_rows)
    problems = []
    if share > limits.majority_share and len(counts) > 1:
        problems.append(f"{top!r} is {share:.0%} of rows, above the {limits.majority_share:.0%} limit")
    if rare:
        problems.append(
            f"{plural(len(rare), 'label')} {agree(len(rare), 'has', 'have')} fewer than {limits.min_label_rows} rows"
        )
    if not problems:
        return Finding(
            "balance",
            "ok",
            "Labels are balanced",
            f"The largest label is {share:.0%} of rows; every label has {limits.min_label_rows} rows or more.",
        )
    majority = share > limits.majority_share and len(counts) > 1
    listed = sorted(rare, key=lambda item: (item[1], item[0]))
    shown = [(top, top_rows)] if majority else []
    return Finding(
        "balance",
        "warning",
        "Unbalanced labels",
        sentence("; ".join(problems)) + ". A model learns rare labels poorly.",
        count=len(rare) + (1 if share > limits.majority_share else 0),
        examples=tuple(f"{label}: {size}" for label, size in rare[:EXAMPLES]),
        rows=sum(size for _, size in rare) if rare else top_rows,
        columns=("Label", "Rows"),
        table=tuple((label, f"{size:,}") for label, size in [*shown, *listed][:TABLE_ROWS]),
    )


def leakage(_rows: list[tuple[str, str]], _limits: CheckLimits, splits: dict[str, list[Example]] | None) -> Finding:
    if splits is None:
        return Finding("leakage", "skipped", "Train and test overlap", "Not checked: too few rows to split.")
    trained = {normalized(example.input) for example in splits["train"] + splits["shots"]}
    tested = [example.input for example in splits["golden"] + splits["eval"] if normalized(example.input) in trained]
    if not tested:
        return Finding(
            "leakage", "ok", "No train and test overlap", "No test or held-out input also appears in training."
        )
    return Finding(
        "leakage",
        "warning",
        "Test rows also in training",
        f"{plural(len(tested), 'test or held-out input')} also {agree(len(tested), 'appears', 'appear')} in training "
        "after ignoring case, spacing and punctuation, so scores read higher than they are.",
        count=len(tested),
        examples=tuple(clip(text) for text in tested[:EXAMPLES]),
        rows=len(tested),
        columns=("Input",),
        table=tuple((clip(text),) for text in tested[:TABLE_ROWS]),
    )


def length(rows: list[tuple[str, str]], _limits: CheckLimits, _splits: object, raw: Rows = ()) -> Finding:
    empty = sum(1 for text, label in raw if label and label.strip() and not (text and text.strip()))
    long = [text for text, _ in rows if len(text) / CHARS_PER_TOKEN > LONG_TOKENS]
    if not empty and not long:
        return Finding("length", "ok", "Input lengths", f"Every input fits in about {LONG_TOKENS:,} tokens.")
    parts = []
    if empty:
        parts.append(
            f"{plural(empty, 'row')} {agree(empty, 'has', 'have')} a label but an empty input and "
            f"{agree(empty, 'is', 'are')} left out"
        )
    if long:
        parts.append(
            f"{plural(len(long), 'input')} {agree(len(long), 'runs', 'run')} past about {LONG_TOKENS:,} tokens "
            f"(estimated at {CHARS_PER_TOKEN} characters a token); training fits its sequence length to the longest "
            "example, so long ones raise the memory every step needs, and anything past the base model's context is cut"
        )
    longest = sorted(long, key=len, reverse=True)[:TABLE_ROWS]
    return Finding(
        "length",
        "warning",
        "Long inputs" if long and not empty else "Empty inputs" if empty and not long else "Empty or long inputs",
        sentence("; ".join(parts)) + ".",
        count=empty + len(long),
        examples=tuple(clip(text) for text in long[:EXAMPLES]),
        rows=empty + len(long),
        handled=not long,
        columns=("Input", "Tokens") if long else (),
        table=tuple((clip(text), f"~{round(len(text) / CHARS_PER_TOKEN):,}") for text in longest),
    )


EMAIL = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}")
PHONE = re.compile(r"(?<![\w+])(?:\+\d{1,3}[\s.-]?)?(?:\(\d{1,4}\)[\s.-]?)?\d{2,4}(?:[\s.-]\d{2,4}){2,4}(?!\w)")
CARD = re.compile(r"(?<!\d)\d(?:[ -]?\d){12,18}(?!\d)")
IBAN = re.compile(r"\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]){11,30}\b")


def luhn(digits: str) -> bool:
    total = 0
    for index, char in enumerate(reversed(digits)):
        value = int(char)
        if index % 2:
            value = value * 2 - 9 if value > 4 else value * 2
        total += value
    return total % 10 == 0


def iban_valid(text: str) -> bool:
    compact = text.replace(" ", "")
    if not 15 <= len(compact) <= 34:
        return False
    moved = compact[4:] + compact[:4]
    number = "".join(str(int(char, 36)) for char in moved)
    return int(number) % 97 == 1


def is_card(found: str) -> bool:
    digits = re.sub(r"\D", "", found)
    return 13 <= len(digits) <= 19 and luhn(digits)


def is_phone(found: str) -> bool:
    digits = len(re.sub(r"\D", "", found))
    least = 8 if found.startswith("+") else 10
    return least <= digits <= 15 and not is_card(found)


PATTERNS: tuple[tuple[str, re.Pattern[str], Callable[[str], bool]], ...] = (
    ("email address", EMAIL, lambda _found: True),
    ("card number", CARD, is_card),
    ("IBAN", IBAN, iban_valid),
    ("phone number", PHONE, is_phone),
)


def matches(text: str) -> list[tuple[str, re.Match[str]]]:
    found: list[tuple[str, re.Match[str]]] = []
    for name, pattern, valid in PATTERNS:
        for match in pattern.finditer(text):
            overlaps = any(match.start() < other.end() and other.start() < match.end() for _, other in found)
            if not overlaps and valid(match.group()):
                found.append((name, match))
    return found


def masked(text: str, found: list[tuple[str, re.Match[str]]]) -> str:
    for name, match in sorted(found, key=lambda item: item[1].start(), reverse=True):
        text = f"{text[: match.start()]}[{name}]{text[match.end() :]}"
    return text


def personal_data(rows: list[tuple[str, str]], _limits: CheckLimits, _splits: object) -> Finding:
    kinds: Counter[str] = Counter()
    hits: list[str] = []
    table: list[tuple[str, str]] = []
    rows_hit = 0
    for text, _ in rows:
        found = matches(text)
        if not found:
            continue
        rows_hit += 1
        names = sorted({name for name, _ in found})
        kinds.update(names)
        if len(hits) < EXAMPLES:
            hits.append(clip(masked(text, found)))
        if len(table) < TABLE_ROWS:
            table.append((clip(masked(text, found)), ", ".join(names)))
    caveat = "Pattern-based: it finds emails, phone numbers, card numbers and IBANs, and can miss names and addresses."
    if not rows_hit:
        return Finding("personal_data", "ok", "No personal data found", caveat)
    summary = ", ".join(plural(count, name) for name, count in kinds.most_common())
    return Finding(
        "personal_data",
        "warning",
        "Possible personal data",
        f"{plural(rows_hit, 'row')} {agree(rows_hit, 'contains', 'contain')} {summary}. {caveat}",
        count=rows_hit,
        examples=tuple(hits),
        rows=rows_hit,
        columns=("Input", "Found"),
        table=tuple(table),
    )


RUNNERS: dict[str, Callable[..., Finding]] = {
    "duplicates": duplicates,
    "conflicts": conflicts,
    "balance": balance,
    "leakage": leakage,
    "length": length,
    "personal_data": personal_data,
}

TITLES = {
    "duplicates": "Repeated inputs",
    "conflicts": "Conflicting labels",
    "balance": "Label balance",
    "leakage": "Train and test overlap",
    "length": "Empty or long inputs",
    "personal_data": "Personal data",
}


TOO_MUCH_TEXT = "Checked when the version is saved: these rows hold too much text to scan as you type."


def run_checks(
    raw: Rows,
    splits: dict[str, list[Example]] | None,
    limits: CheckLimits,
    labelled: bool = True,
    examples: int | None = None,
    only: Sequence[str] = CHECKS,
    text_budget: int | None = None,
) -> list[Finding]:
    rows = usable(raw)
    kept = examples if examples is not None else len({text for text, _ in rows})
    findings = hard_stops(rows, labelled, kept)
    too_much = text_budget is not None and sum(len(text) for text, _ in rows) > text_budget
    for name in CHECKS:
        if name not in only:
            continue
        if name in limits.off:
            findings.append(Finding(name, "off", TITLES[name], "Turned off under Settings, Data."))
        elif name == "personal_data" and too_much:
            findings.append(Finding(name, "skipped", TITLES[name], TOO_MUCH_TEXT))
        elif name == "length":
            findings.append(length(rows, limits, splits, raw))
        elif name == "balance":
            findings.append(balance(rows, limits, splits, labelled))
        else:
            findings.append(RUNNERS[name](rows, limits, splits))
    return findings


def blocks_saving(finding: Finding) -> bool:
    too_few = finding.check == "empty" and finding.count > 0
    return finding.status == "blocked" and not too_few


def blocking(findings: Sequence[Finding]) -> Finding | None:
    return next((finding for finding in findings if blocks_saving(finding)), None)
