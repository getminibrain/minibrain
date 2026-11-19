import re
from collections.abc import Sequence

from minibrain.data.cleanup import CLEANUP_KEYS, checked_cleanup, cleaned_sql
from minibrain.data.sources import SourceError, filled, quote_identifier, quote_literal, select_from

PLACEHOLDER = re.compile(r"\{([^{}\n]+)\}")
MESSAGES = "messages"
USER = "user"
ASSISTANT = "assistant"
SKIP_EMPTY = "skip_empty"
INPUT_COLUMN = "input_column"
LABEL_COLUMN = "label_column"
PAIR_KEYS = {INPUT_COLUMN, LABEL_COLUMN}

Template = dict[str, str]


def pair_template(input_column: str, label_column: str) -> Template:
    return {INPUT_COLUMN: input_column, LABEL_COLUMN: label_column}


def chat_template(column: str = MESSAGES) -> Template:
    return {MESSAGES: column}


def is_chat(template: Template) -> bool:
    return MESSAGES in template


def is_pair(template: Template) -> bool:
    return bool(PAIR_KEYS & set(template))


def skips_empty(template: Template | None) -> bool:
    return bool(template and template.get(SKIP_EMPTY))


def skipping_empty(template: Template, skip: bool) -> Template:
    found = {key: value for key, value in template.items() if key != SKIP_EMPTY}
    return {**found, SKIP_EMPTY: "true"} if skip and not is_chat(found) else found


def cleanup_of(template: Template | None) -> dict[str, str]:
    if not template or is_chat(template):
        return {}
    return {key: template[key] for key in CLEANUP_KEYS if key in template}


def cleaning(template: Template, cleanup: dict[str, str]) -> Template:
    found = {key: value for key, value in template.items() if key not in CLEANUP_KEYS}
    return found if is_chat(found) else {**found, **checked_cleanup(cleanup)}


def columns_in(text: str) -> list[str]:
    return [match.group(1) for match in PLACEHOLDER.finditer(text)]


def template_columns(template: Template) -> list[str]:
    if is_chat(template):
        return [template[MESSAGES]]
    if is_pair(template):
        return list(dict.fromkeys([template[INPUT_COLUMN], template[LABEL_COLUMN]]))
    return list(dict.fromkeys([*columns_in(template.get(USER, "")), *columns_in(template.get(ASSISTANT, ""))]))


def single_column(text: str) -> str | None:
    found = PLACEHOLDER.fullmatch(text.strip())
    return found.group(1) if found else None


def plain_columns(template: Template | None) -> tuple[str | None, str | None]:
    if not template or is_chat(template):
        return None, None
    if is_pair(template):
        return template.get(INPUT_COLUMN), template.get(LABEL_COLUMN)
    return single_column(template.get(USER, "")), single_column(template.get(ASSISTANT, ""))


def text_sql(text: str) -> str:
    parts: list[str] = []
    position = 0
    for match in PLACEHOLDER.finditer(text):
        if match.start() > position:
            parts.append(quote_literal(text[position : match.start()]))
        parts.append(f"coalesce(CAST({quote_identifier(match.group(1))} AS VARCHAR), '')")
        position = match.end()
    if position < len(text):
        parts.append(quote_literal(text[position:]))
    if not PLACEHOLDER.search(text):
        raise SourceError("each template names at least one column, such as {text}")
    return " || ".join(parts) if len(parts) > 1 else parts[0]


def plain_sql(column: str) -> str:
    return f"CAST({quote_identifier(column)} AS VARCHAR)"


def slot_sql(text: str) -> str:
    column = single_column(text)
    return plain_sql(column) if column is not None and text.strip() == text else text_sql(text)


def checked(template: Template) -> Template:
    if is_chat(template):
        if set(template) != {MESSAGES} or not template[MESSAGES].strip():
            raise SourceError("a chat mapping names the column that holds the messages")
        return {MESSAGES: template[MESSAGES].strip()}
    if is_pair(template):
        if set(template) - {SKIP_EMPTY, *CLEANUP_KEYS} != PAIR_KEYS or not all(template[key] for key in PAIR_KEYS):
            raise SourceError("a column mapping names the input column and the label column")
        return cleaning(skipping_empty(template, skips_empty(template)), cleanup_of(template))
    if set(template) - {SKIP_EMPTY, *CLEANUP_KEYS} != {USER, ASSISTANT}:
        raise SourceError("a mapping fills the user and assistant messages, or names a messages column")
    for slot in (USER, ASSISTANT):
        if not columns_in(template[slot]):
            raise SourceError(f"the {slot} message names at least one column, such as {{text}}")
    return cleaning(skipping_empty(template, skips_empty(template)), cleanup_of(template))


def template_sql(template: Template, tables: Sequence[str]) -> str:
    found = checked(template)
    if is_chat(found):
        return select_from([(quote_identifier(found[MESSAGES]), MESSAGES)], tables)
    pair = is_pair(found)
    text = plain_sql(found[INPUT_COLUMN]) if pair else slot_sql(found[USER])
    label = plain_sql(found[LABEL_COLUMN]) if pair else slot_sql(found[ASSISTANT])
    where = filled(label) if skips_empty(found) else None
    sql = select_from([(text, "input"), (label, "label")], tables, where)
    return cleaned_sql(sql, cleanup_of(found))


def missing_columns(template: Template, columns: Sequence[str]) -> list[str]:
    known = set(columns)
    return [name for name in template_columns(template) if name not in known]
