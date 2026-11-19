import { IconBook2, IconChevronDown, IconPlus, IconX } from "@tabler/icons-react";
import {
    Badge,
    Button,
    CheckboxField,
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
    InfoTip,
    SegmentedTabs,
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
    SqlEditor,
    type SqlEditorHandle,
    type SqlSchema,
} from "obp-ui";
import { type RefObject, useEffect, useRef } from "react";
import type { DatasetSummary, MappingInfo, SourceStats, SourceSummary } from "~/api/client";
import { useSourceRows, useSourcesStats } from "~/api/queries";
import { FORM_ROW_GAP, FormControl, FormRow, FormRows } from "~/components/FormRows";
import { count } from "~/lib/format";
import type { SqlProblem } from "~/lib/sqlError";
import { type CleanupDefaults, CleanupGroup } from "./CleanupGroup";
import type { SampleRequest } from "./SampleOffer";
import { type Cleanup, NO_CLEANUP, cleanedSql, sameCleanup } from "./cleanup";
import {
    type ColumnFacts,
    type Suggestion,
    columnFacts,
    rowsSuggestion,
    statsSuggestion,
} from "./columnFacts";
import { typeWord } from "./columnTypes";
import { DUCKDB_WORDS } from "./duckdbWords";
import { SourceIcon } from "./icons";
import { RECIPES, type RecipeSource, recipeSql } from "./recipes";
import {
    type Picks,
    columnsSql,
    everythingSql,
    guessPair,
    mentions,
    quoted,
    sharedColumns,
    starterSql,
} from "./sql";

export type MappingBody = {
    source_id?: number;
    source_ids?: number[];
    input_column?: string;
    label_column?: string;
    skip_empty?: boolean;
    cleanup?: Cleanup;
    sql?: string;
    sample?: SampleRequest;
};

type Mode = DatasetSummary["mode"];

export type Role = "input" | "label";

export type Draft = {
    mode: Mode;
    sources: string[];
    input: string;
    label: string;
    skipEmpty: boolean;
    cleanup: Cleanup;
    sql: string;
    guessed: Role[];
};

export const MODES = [
    { key: "columns", label: "Pick columns" },
    { key: "sql", label: "Write SQL" },
];

export function switchedDraft(
    draft: Draft,
    next: string,
    sources: SourceSummary[],
    chars: number | null,
): Draft {
    const seeded = next === "sql" && !draft.sql.trim() ? draftSql(draft, sources, chars) : null;
    return { ...draft, mode: next as Mode, sql: seeded ?? draft.sql };
}

const NONE = "none";

const ROLE_TABS = [
    { key: "input", label: "Text" },
    { key: "label", label: "Answer" },
    { key: NONE, label: "—", tip: "Not used" },
];

export const QUERY_HELP =
    "Pick a source and the columns a model reads and answers with, or write SQL over one or more sources.";

export function Clamp({ text }: { text: unknown }) {
    return (
        <span className="line-clamp-2 max-w-xl whitespace-normal">
            {text === null || text === undefined || text === "" ? "–" : String(text)}
        </span>
    );
}

export function chosenSources(draft: Draft, sources: SourceSummary[]): SourceSummary[] {
    return draft.sources.flatMap((id) => sources.filter((item) => String(item.id) === id));
}

function picksOf(draft: Draft, sources: SourceSummary[]): Picks | null {
    const chosen = chosenSources(draft, sources);
    const columns = sharedColumns(chosen);
    if (!draft.input || !draft.label || !columns.includes(draft.input)) {
        return null;
    }
    if (!columns.includes(draft.label)) {
        return null;
    }
    return {
        tables: chosen.map((item) => item.table),
        input: draft.input,
        label: draft.label,
        skipEmpty: draft.skipEmpty,
    };
}

function compiled(sql: string, draft: Draft, chars: number | null): string | null {
    if (draft.cleanup.max_tokens && chars === null) {
        return null;
    }
    return cleanedSql(sql, draft.cleanup, chars ?? 0);
}

export function draftSql(
    draft: Draft,
    sources: SourceSummary[],
    chars: number | null,
): string | null {
    if (draft.mode === "sql") {
        return draft.sql.trim() || null;
    }
    const picks = picksOf(draft, sources);
    return picks ? compiled(columnsSql(picks), draft, chars) : null;
}

export function previewSql(
    draft: Draft,
    sources: SourceSummary[],
    chars: number | null,
): string | null {
    if (draft.mode === "sql") {
        return draft.sql.trim() || null;
    }
    const chosen = chosenSources(draft, sources);
    const columns = sharedColumns(chosen);
    if (columns.length === 0) {
        return null;
    }
    const picks = picksOf(draft, sources);
    return picks
        ? compiled(columnsSql(picks, columns), draft, chars)
        : everythingSql(chosen.map((item) => item.table));
}

export function draftBody(draft: Draft, sources: SourceSummary[]): MappingBody | null {
    if (draft.mode === "sql") {
        return draft.sql.trim() ? { sql: draft.sql } : null;
    }
    const picks = picksOf(draft, sources);
    if (!picks) {
        return null;
    }
    const ids = chosenSources(draft, sources).map((item) => item.id);
    return {
        ...(ids.length === 1 ? { source_id: ids[0] } : { source_ids: ids }),
        input_column: picks.input,
        label_column: picks.label,
        skip_empty: picks.skipEmpty,
        cleanup: draft.cleanup,
    };
}

export function sameDraft(left: Draft, right: Draft): boolean {
    if (left.mode !== right.mode) {
        return false;
    }
    return left.mode === "sql"
        ? left.sql === right.sql
        : left.sources.join() === right.sources.join() &&
              left.input === right.input &&
              left.label === right.label &&
              left.skipEmpty === right.skipEmpty &&
              sameCleanup(left.cleanup, right.cleanup);
}

export function savedDraft(
    mapping: MappingInfo,
    mode: Mode,
    sourceIds: number[],
    sources: SourceSummary[],
): Draft {
    const columns = mode === "columns" && sourceIds.length > 0;
    const fallback = mapping.sql ? [] : [String(sources[0]?.id ?? "")].filter(Boolean);
    return {
        mode,
        sources: columns ? sourceIds.map(String) : fallback,
        input: mapping.input_column ?? "",
        label: mapping.label_column ?? "",
        skipEmpty: mode === "columns" ? Boolean(mapping.skip_empty) : true,
        cleanup: mode === "columns" ? { ...NO_CLEANUP, ...mapping.cleanup } : NO_CLEANUP,
        sql: mapping.sql ?? "",
        guessed: [],
    };
}

export function pickedDraft(chosen: SourceSummary[]): Draft {
    const [input, label] = guessPair(sharedColumns(chosen));
    const guessed: Role[] = [];
    if (input) {
        guessed.push("input");
    }
    if (label) {
        guessed.push("label");
    }
    return {
        mode: "columns",
        sources: chosen.map((item) => String(item.id)),
        input,
        label,
        skipEmpty: true,
        cleanup: NO_CLEANUP,
        sql: "",
        guessed,
    };
}

function without(list: Role[], ...roles: Role[]): Role[] {
    return list.filter((role) => !roles.includes(role));
}

export function withRole(draft: Draft, column: string, role: Role | null): Draft {
    if (role === null) {
        const cleared: Role[] = [];
        if (draft.input === column) {
            cleared.push("input");
        }
        if (draft.label === column) {
            cleared.push("label");
        }
        return {
            ...draft,
            input: draft.input === column ? "" : draft.input,
            label: draft.label === column ? "" : draft.label,
            guessed: without(draft.guessed, ...cleared),
        };
    }
    const other: Role = role === "input" ? "label" : "input";
    const moved = draft[other] === column;
    return {
        ...draft,
        [role]: column,
        [other]: moved ? "" : draft[other],
        guessed: moved ? without(draft.guessed, role, other) : without(draft.guessed, role),
    };
}

function applied(draft: Draft, suggestion: Suggestion): Draft {
    const input = draft.guessed.includes("input") ? suggestion.input : draft.input;
    const label =
        draft.guessed.includes("label") && suggestion.label && suggestion.label !== input
            ? suggestion.label
            : draft.label === input
              ? ""
              : draft.label;
    return {
        ...draft,
        input,
        label,
        guessed: draft.guessed.filter((role) => Boolean(role === "input" ? input : label)),
    };
}

function useSuggestion(chosen: SourceSummary[], columns: string[]) {
    const stats = useSourcesStats(chosen.map((item) => item.id));
    const first = stats[0];
    const fallback = useSourceRows(chosen[0]?.id ?? 0, undefined, Boolean(first?.isError));
    const suggestion = first?.isError
        ? rowsSuggestion(fallback.data, columns)
        : statsSuggestion(first?.data, columns);
    return { stats: stats.map((item) => item.data), suggestion };
}

function SourceSelect({
    id,
    value,
    placeholder,
    sources,
    onChange,
}: {
    id: string;
    value: string;
    placeholder: string;
    sources: SourceSummary[];
    onChange: (value: string) => void;
}) {
    return (
        <Select value={value} onValueChange={(next) => onChange(String(next ?? ""))}>
            <SelectTrigger id={id} className="w-full">
                <SelectValue placeholder={placeholder} />
            </SelectTrigger>
            <SelectContent>
                {sources.map((item) => (
                    <SelectItem key={item.id} value={String(item.id)} description={item.table}>
                        {item.name}
                    </SelectItem>
                ))}
            </SelectContent>
        </Select>
    );
}

function AddSource({
    sources,
    onAdd,
}: {
    sources: SourceSummary[];
    onAdd: (id: string) => void;
}) {
    return (
        <Select value="" onValueChange={(next) => next && onAdd(String(next))}>
            <SelectTrigger aria-label="Combine with another source" className="w-auto">
                <span className="inline-flex items-center gap-1.5">
                    <IconPlus className="size-4" />
                    Combine
                </span>
            </SelectTrigger>
            <SelectContent>
                {sources.map((item) => (
                    <SelectItem key={item.id} value={String(item.id)} description={item.table}>
                        {item.name}
                    </SelectItem>
                ))}
            </SelectContent>
        </Select>
    );
}

function SourcePicker({
    draft,
    sources,
    onPick,
}: {
    draft: Draft;
    sources: SourceSummary[];
    onPick: (ids: string[]) => void;
}) {
    const [first = "", ...rest] = draft.sources;
    const chosen = chosenSources(draft, sources);
    const others = sources.filter((item) => !draft.sources.includes(String(item.id)));
    return (
        <FormRows labels="compact">
            <FormRow id="dataset-source" label="Source">
                <FormControl>
                    <SourceSelect
                        id="dataset-source"
                        value={first}
                        placeholder="Pick a source"
                        sources={sources.filter(
                            (item) => String(item.id) === first || !rest.includes(String(item.id)),
                        )}
                        onChange={(next) => onPick([next, ...rest])}
                    />
                </FormControl>
                {first && others.length > 0 && (
                    <AddSource
                        sources={others}
                        onAdd={(next) => onPick([...draft.sources, next])}
                    />
                )}
            </FormRow>
            {rest.length > 0 && (
                <FormRow label="Plus" align="start">
                    <ul className="flex w-full flex-col">
                        {chosen.slice(1).map((item) => (
                            <li key={item.id} className="flex h-8 min-w-0 items-center gap-2">
                                <span className="truncate">{item.name}</span>
                                <span className="truncate font-mono text-sm text-muted-foreground">
                                    {item.table}
                                </span>
                                <Button
                                    variant="ghost"
                                    size="icon-xs"
                                    aria-label={`Stop combining ${item.name}`}
                                    onClick={() =>
                                        onPick(draft.sources.filter((id) => id !== String(item.id)))
                                    }
                                >
                                    <IconX />
                                </Button>
                            </li>
                        ))}
                    </ul>
                </FormRow>
            )}
        </FormRows>
    );
}

function RoleLine({
    title,
    hint,
    column,
    guessed,
}: {
    title: string;
    hint: string;
    column: string;
    guessed: boolean;
}) {
    return (
        <>
            <dt className="flex items-baseline gap-2">
                {title}
                <span className="font-mono text-sm text-muted-foreground">{hint}</span>
            </dt>
            <dd className="flex min-w-0 items-center gap-2">
                {column ? (
                    <span className="truncate font-mono">{column}</span>
                ) : (
                    <span className="text-muted-foreground">Pick a column below</span>
                )}
                {guessed && column && <Badge variant="neutral">suggested</Badge>}
            </dd>
        </>
    );
}

function roleOf(draft: Draft, column: string): string {
    if (draft.input === column) {
        return "input";
    }
    return draft.label === column ? "label" : NONE;
}

function ColumnRow({
    facts,
    role,
    onRole,
}: {
    facts: ColumnFacts;
    role: string;
    onRole: (role: string) => void;
}) {
    return (
        <tr className="h-10">
            <td className="max-w-0 px-3">
                <span
                    className="flex min-w-0 items-baseline gap-2"
                    title={facts.type ? `${facts.name}: ${typeWord(facts.type)}` : facts.name}
                >
                    <span className="max-w-full shrink-0 truncate font-mono">{facts.name}</span>
                    <span className="hidden min-w-0 truncate text-sm text-muted-foreground @xs:inline @2xl:hidden">
                        {facts.samples.join(" · ")}
                    </span>
                </span>
            </td>
            <td className="hidden px-3 whitespace-nowrap text-sm text-muted-foreground @lg:table-cell">
                {facts.type ? typeWord(facts.type) : "–"}
            </td>
            <td className="hidden max-w-0 px-3 @2xl:table-cell">
                <span
                    className="block truncate text-sm text-muted-foreground"
                    title={facts.samples.join("\n")}
                >
                    {facts.samples.join(" · ") || "–"}
                </span>
            </td>
            <td className="hidden px-3 text-right text-sm tabular-nums @xs:table-cell">
                {facts.distinct === null ? "–" : count(facts.distinct)}
            </td>
            <td className="py-1 pr-1.5 pl-0 text-right">
                <SegmentedTabs size="sm" tabs={ROLE_TABS} active={role} onSelect={onRole} />
            </td>
        </tr>
    );
}

function ColumnList({
    facts,
    draft,
    onChange,
}: {
    facts: ColumnFacts[];
    draft: Draft;
    onChange: (draft: Draft) => void;
}) {
    const choose = (column: string, role: string) => {
        if (role === roleOf(draft, column) && role !== NONE) {
            onChange({ ...draft, guessed: without(draft.guessed, role as Role) });
            return;
        }
        onChange(withRole(draft, column, role === NONE ? null : (role as Role)));
    };
    return (
        <div className="@container max-h-[28rem] overflow-y-auto rounded-lg border">
            <table className="w-full table-fixed border-collapse">
                <thead className="sticky top-0 z-[1] bg-card text-left text-sm text-muted-foreground">
                    <tr className="h-8 border-b">
                        <th className="px-3 font-normal">Column</th>
                        <th className="hidden w-32 px-3 font-normal @lg:table-cell">Type</th>
                        <th className="hidden px-3 font-normal @2xl:table-cell">Values</th>
                        <th className="hidden w-20 px-3 text-right font-normal @xs:table-cell">
                            Distinct
                        </th>
                        <th className="w-43 pr-3 text-right font-normal">Use as</th>
                    </tr>
                </thead>
                <tbody className="divide-y">
                    {facts.map((item) => (
                        <ColumnRow
                            key={item.name}
                            facts={item}
                            role={roleOf(draft, item.name)}
                            onRole={(role) => choose(item.name, role)}
                        />
                    ))}
                </tbody>
            </table>
        </div>
    );
}

function ColumnsMode({
    draft,
    sources,
    cleanupDefaults,
    onChange,
    onSwitch,
}: {
    draft: Draft;
    sources: SourceSummary[];
    cleanupDefaults: CleanupDefaults;
    onChange: (draft: Draft) => void;
    onSwitch: () => void;
}) {
    const chosen = chosenSources(draft, sources);
    const columns = sharedColumns(chosen);
    const { stats, suggestion } = useSuggestion(chosen, columns);
    const facts = columnFacts(chosen, stats, columns);
    const latest = useRef({ draft, onChange });
    latest.current = { draft, onChange };
    const suggestionKey = suggestion
        ? [suggestion.input, suggestion.label, ...draft.sources].join("\n")
        : "";
    useEffect(() => {
        const { draft: current, onChange: change } = latest.current;
        if (!suggestionKey || current.guessed.length === 0) {
            return;
        }
        const [input = "", label = ""] = suggestionKey.split("\n");
        const next = applied(current, { input, label });
        if (next.input !== current.input || next.label !== current.label) {
            change(next);
        }
    }, [suggestionKey]);
    const pick = (ids: string[]) =>
        onChange({
            ...pickedDraft(ids.flatMap((id) => sources.filter((item) => String(item.id) === id))),
            skipEmpty: draft.skipEmpty,
            cleanup: draft.cleanup,
            sql: draft.sql,
        });
    return (
        <div className={`flex min-w-0 flex-col ${FORM_ROW_GAP}`}>
            <SourcePicker draft={draft} sources={sources} onPick={pick} />
            {chosen.length > 1 && columns.length === 0 ? (
                <p className="text-muted-foreground">
                    These sources share no column names.{" "}
                    <Button variant="link" className="h-auto p-0" onClick={onSwitch}>
                        Write SQL
                    </Button>{" "}
                    to join them or map their columns.
                </p>
            ) : chosen.length > 0 ? (
                <>
                    <div className="@container">
                        <dl className="grid grid-cols-1 gap-x-6 gap-y-1 @sm:grid-cols-[max-content_minmax(0,1fr)] @sm:items-center @sm:gap-y-2">
                            <RoleLine
                                title="Text the model reads"
                                hint="input"
                                column={draft.input}
                                guessed={draft.guessed.includes("input")}
                            />
                            <RoleLine
                                title="Answer it should give"
                                hint="label"
                                column={draft.label}
                                guessed={draft.guessed.includes("label")}
                            />
                        </dl>
                    </div>
                    <div className="flex flex-col gap-2">
                        {chosen.length > 1 && (
                            <p className="text-sm text-muted-foreground">
                                Rows from {chosen.length} sources are combined by column name; the
                                list shows the columns they share.
                            </p>
                        )}
                        <ColumnList facts={facts} draft={draft} onChange={onChange} />
                    </div>
                    <CheckboxField
                        label="Skip rows with no answer"
                        checked={draft.skipEmpty}
                        onCheckedChange={(checked) =>
                            onChange({ ...draft, skipEmpty: checked === true })
                        }
                    />
                    <CleanupGroup
                        cleanup={draft.cleanup}
                        defaults={cleanupDefaults}
                        onChange={(cleanup) => onChange({ ...draft, cleanup })}
                    />
                </>
            ) : null}
        </div>
    );
}

const PLAIN_NAME = /^[a-z_][a-z0-9_]*$/;

function columnName(name: string): string {
    return PLAIN_NAME.test(name) ? name : quoted(name);
}

function TableList({
    sources,
    onInsert,
}: {
    sources: SourceSummary[];
    onInsert: (name: string) => void;
}) {
    const insertable =
        "rounded-sm outline-none hover:bg-secondary hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring";
    return (
        <div className="flex max-h-64 min-h-0 min-w-0 flex-col rounded-lg border @2xl:max-h-none">
            <div className="border-b px-3 py-1.5 text-sm text-muted-foreground">
                Sources · click a name to add it to the query
            </div>
            {sources.length === 0 ? (
                <p className="px-3 py-2 text-muted-foreground">No sources yet.</p>
            ) : (
                <ul className="min-h-0 flex-1 divide-y overflow-y-auto">
                    {[...sources]
                        .sort((left, right) => left.table.localeCompare(right.table))
                        .map((source) => (
                            <li
                                key={source.id}
                                className="flex flex-col items-start gap-1 px-2 py-1.5"
                            >
                                <span className="flex w-full min-w-0 items-center gap-1.5">
                                    <SourceIcon
                                        source={source}
                                        className="ml-1 size-4 shrink-0 text-muted-foreground"
                                    />
                                    <button
                                        type="button"
                                        title={`Insert ${source.table}`}
                                        onClick={() => onInsert(source.table)}
                                        className={`min-w-0 truncate px-1 font-mono ${insertable}`}
                                    >
                                        {source.table}
                                    </button>
                                    {source.rows === null ? null : (
                                        <span className="ml-auto shrink-0 pr-1 text-sm text-muted-foreground tabular-nums">
                                            {`${count(source.rows)} ${source.rows === 1 ? "row" : "rows"}`}
                                        </span>
                                    )}
                                </span>
                                <span className="flex flex-wrap gap-x-1 gap-y-0.5">
                                    {source.columns.map((column) => (
                                        <button
                                            key={column.name}
                                            type="button"
                                            title={`Insert ${columnName(column.name)}`}
                                            onClick={() => onInsert(columnName(column.name))}
                                            className={`px-1 font-mono text-sm text-muted-foreground ${insertable}`}
                                        >
                                            {column.name}
                                        </button>
                                    ))}
                                </span>
                            </li>
                        ))}
                </ul>
            )}
        </div>
    );
}

function recipeSources(
    sources: SourceSummary[],
    stats: (SourceStats | undefined)[],
): (RecipeSource & { id: number })[] {
    return sources.flatMap((source, index) => {
        const names = source.columns.map((column) => column.name);
        const suggestion = statsSuggestion(stats[index], names);
        const [input, label] = guessPair(names);
        const text = suggestion?.input || input;
        const answer = suggestion?.label || label;
        return text && answer
            ? [{ id: source.id, table: source.table, input: text, label: answer }]
            : [];
    });
}

function ExamplesMenu({
    base,
    others,
    onPick,
}: {
    base: string | null;
    others: RecipeSource[];
    onPick: (sql: string) => void;
}) {
    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" disabled={base === null}>
                    <IconBook2 />
                    Examples
                    <IconChevronDown />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-80">
                {RECIPES.map((recipe) => {
                    const sql = base === null ? null : recipeSql(recipe, base, others);
                    const Icon = recipe.icon;
                    return (
                        <DropdownMenuItem
                            key={recipe.key}
                            disabled={sql === null}
                            onSelect={() => sql && onPick(sql)}
                            className="items-start"
                        >
                            <Icon className="mt-0.5" />
                            <span className="flex min-w-0 flex-col">
                                <span>{recipe.label}</span>
                                <span className="text-sm text-muted-foreground">
                                    {recipe.detail}
                                </span>
                            </span>
                        </DropdownMenuItem>
                    );
                })}
            </DropdownMenuContent>
        </DropdownMenu>
    );
}

function editorSchema(sources: SourceSummary[], stats: (SourceStats | undefined)[]): SqlSchema {
    return Object.fromEntries(
        sources.map((source, index) => [
            source.table,
            columnFacts(
                [source],
                [stats[index]],
                source.columns.map((column) => column.name),
            ).map((facts) => ({ name: facts.name, type: facts.type, samples: facts.samples })),
        ]),
    );
}

function starterFor(draft: Draft, sources: SourceSummary[], stats: (SourceStats | undefined)[]) {
    const index = Math.max(
        0,
        sources.findIndex((item) => String(item.id) === draft.sources[0]),
    );
    const source = sources[index];
    if (!source) {
        return undefined;
    }
    const names = source.columns.map((column) => column.name);
    const suggestion = statsSuggestion(stats[index], names);
    const [input, label] = guessPair(names);
    const text = suggestion?.input || input;
    const answer = suggestion?.label || label;
    return text && answer ? starterSql(source.table, text, answer) : undefined;
}

function SqlMode({
    draft,
    sources,
    problem,
    editor,
    onChange,
    onRun,
}: {
    draft: Draft;
    sources: SourceSummary[];
    problem: SqlProblem | null;
    editor: RefObject<SqlEditorHandle | null>;
    onChange: (draft: Draft) => void;
    onRun: (sql: string) => void;
}) {
    const stats = useSourcesStats(sources.map((item) => item.id)).map((item) => item.data);
    const starter = starterFor(draft, sources, stats);
    const known = recipeSources(sources, stats);
    const current =
        known.find((item) => mentions(draft.sql, item.table)) ??
        known.find((item) => String(item.id) === draft.sources[0]) ??
        known[0];
    const base = draft.sql.trim() ? draft.sql : (starter ?? null);
    return (
        <div className="@container flex min-h-0 flex-1 flex-col gap-3">
            <div className="flex shrink-0 items-center gap-2">
                <ExamplesMenu
                    base={base}
                    others={known.filter((item) => item !== current)}
                    onPick={(sql) => void editor.current?.replace(sql, { format: true })}
                />
                <p className="min-w-0 truncate text-sm text-muted-foreground">
                    Return columns named <span className="font-mono">input</span> and{" "}
                    <span className="font-mono">label</span>
                </p>
                <InfoTip label="About dataset SQL" side="bottom">
                    Other columns are kept in each version. Join, union, filter and clean up with
                    DuckDB SQL. On sources under a million rows the preview runs when you stop
                    typing; on larger ones it runs when you press Run. Cmd/Ctrl+Enter runs it at
                    once, or only the selected part. Hover a column name for its type and values.
                    Queries are read-only and cannot reach other files or the network.
                </InfoTip>
            </div>
            <div className="grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)_auto] gap-3 @2xl:grid-cols-[minmax(0,1fr)_14rem] @2xl:grid-rows-[minmax(0,1fr)]">
                <SqlEditor
                    ref={editor}
                    value={draft.sql}
                    onValueChange={(sql) => onChange({ ...draft, sql })}
                    onRun={onRun}
                    schema={editorSchema(sources, stats)}
                    completions={DUCKDB_WORDS}
                    diagnostics={problem?.diagnostics}
                    minLines={8}
                    fill
                    aria-label="SQL"
                    starter={starter}
                    placeholder="SELECT text AS input, category AS label FROM tickets"
                />
                <TableList sources={sources} onInsert={(name) => editor.current?.insert(name)} />
            </div>
        </div>
    );
}

export function QueryEditor({
    draft,
    sources,
    problem,
    chars,
    cleanupDefaults,
    editor,
    onChange,
    onRun,
}: {
    draft: Draft;
    sources: SourceSummary[];
    problem: SqlProblem | null;
    chars: number | null;
    cleanupDefaults: CleanupDefaults;
    editor: RefObject<SqlEditorHandle | null>;
    onChange: (draft: Draft) => void;
    onRun: (sql: string) => void;
}) {
    return (
        <div className={`flex min-h-0 min-w-0 flex-1 flex-col ${FORM_ROW_GAP}`}>
            {draft.mode === "sql" ? (
                <SqlMode
                    draft={draft}
                    sources={sources}
                    problem={problem}
                    editor={editor}
                    onChange={onChange}
                    onRun={onRun}
                />
            ) : (
                <ColumnsMode
                    draft={draft}
                    sources={sources}
                    cleanupDefaults={cleanupDefaults}
                    onChange={onChange}
                    onSwitch={() => onChange(switchedDraft(draft, "sql", sources, chars))}
                />
            )}
        </div>
    );
}
