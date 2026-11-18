import {
    SegmentedTabs,
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
    SqlEditor,
    type SqlEditorHandle,
} from "obp-ui";
import { useRef } from "react";
import type { DatasetSummary, MappingInfo, SourceSummary } from "~/api/client";
import { FORM_ROW_GAP, FormControl, FormRow, FormRows } from "~/components/FormRows";
import type { SqlProblem } from "~/lib/sqlError";
import type { SampleRequest } from "./SampleOffer";
import { typeWord } from "./columnTypes";
import { columnsSql, guessPair } from "./sql";

export type MappingBody = {
    source_id?: number;
    input_column?: string;
    label_column?: string;
    sql?: string;
    sample?: SampleRequest;
};

type Mode = DatasetSummary["mode"];

export type Draft = { mode: Mode; source: string; input: string; label: string; sql: string };

const MODES = [
    { key: "columns", label: "Pick columns" },
    { key: "sql", label: "Write SQL" },
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

function sourceOf(draft: Draft, sources: SourceSummary[]): SourceSummary | undefined {
    return sources.find((item) => String(item.id) === draft.source);
}

export function draftSql(draft: Draft, sources: SourceSummary[]): string | null {
    if (draft.mode === "sql") {
        return draft.sql.trim() || null;
    }
    const chosen = sourceOf(draft, sources);
    return chosen && draft.input && draft.label
        ? columnsSql(chosen.table, draft.input, draft.label)
        : null;
}

export function draftBody(draft: Draft, sources: SourceSummary[]): MappingBody | null {
    if (draft.mode === "sql") {
        return draft.sql.trim() ? { sql: draft.sql } : null;
    }
    const chosen = sourceOf(draft, sources);
    return chosen && draft.input && draft.label
        ? { source_id: chosen.id, input_column: draft.input, label_column: draft.label }
        : null;
}

export function sameDraft(left: Draft, right: Draft): boolean {
    if (left.mode !== right.mode) {
        return false;
    }
    return left.mode === "sql"
        ? left.sql === right.sql
        : left.source === right.source && left.input === right.input && left.label === right.label;
}

export function savedDraft(
    mapping: MappingInfo,
    mode: Mode,
    sourceId: number | null | undefined,
    sources: SourceSummary[],
): Draft {
    const source =
        sourceId !== null && sourceId !== undefined
            ? String(sourceId)
            : mapping.sql
              ? ""
              : String(sources[0]?.id ?? "");
    return {
        mode,
        source,
        input: mapping.input_column ?? "",
        label: mapping.label_column ?? "",
        sql: mapping.sql ?? "",
    };
}

function sourceColumns(source: SourceSummary | undefined): string[] {
    return (source?.columns ?? []).map((column) => column.name);
}

export function pickedDraft(source: SourceSummary | undefined): Draft {
    const [input, label] = guessPair(sourceColumns(source));
    return { mode: "columns", source: source ? String(source.id) : "", input, label, sql: "" };
}

function ColumnSelect({
    id,
    label,
    value,
    options,
    placeholder,
    onChange,
    disabled,
}: {
    id: string;
    label: string;
    value: string;
    options: { value: string; label: string; description?: string }[];
    placeholder: string;
    onChange: (value: string) => void;
    disabled?: boolean;
}) {
    return (
        <FormRow id={id} label={label}>
            <FormControl>
                <Select
                    value={value}
                    onValueChange={(next) => onChange(String(next ?? ""))}
                    disabled={disabled}
                >
                    <SelectTrigger id={id} className="w-full">
                        <SelectValue placeholder={placeholder} />
                    </SelectTrigger>
                    <SelectContent>
                        {options.map((option) => (
                            <SelectItem
                                key={option.value}
                                value={option.value}
                                description={option.description}
                            >
                                {option.label}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </FormControl>
        </FormRow>
    );
}

function TableList({
    sources,
    onInsert,
}: {
    sources: SourceSummary[];
    onInsert: (name: string) => void;
}) {
    return (
        <div className="flex min-w-0 flex-col rounded-lg border">
            <div className="border-b px-3 py-1.5 text-sm text-muted-foreground">
                Tables: click one to insert its name
            </div>
            {sources.length === 0 ? (
                <p className="px-3 py-2 text-muted-foreground">No sources yet.</p>
            ) : (
                <ul className="max-h-64 divide-y overflow-y-auto">
                    {[...sources]
                        .sort((left, right) => left.table.localeCompare(right.table))
                        .map((source) => (
                            <li key={source.id}>
                                <button
                                    type="button"
                                    onClick={() => onInsert(source.table)}
                                    className="flex w-full flex-col items-start gap-0.5 px-3 py-1.5 text-left outline-none hover:bg-secondary focus-visible:ring-2 focus-visible:ring-ring"
                                >
                                    <span className="font-mono">{source.table}</span>
                                    <span className="w-full truncate text-sm text-muted-foreground">
                                        {source.columns.map((column) => column.name).join(", ")}
                                    </span>
                                </button>
                            </li>
                        ))}
                </ul>
            )}
        </div>
    );
}

function SqlMode({
    draft,
    sources,
    problem,
    onChange,
    onRun,
}: {
    draft: Draft;
    sources: SourceSummary[];
    problem: SqlProblem | null;
    onChange: (draft: Draft) => void;
    onRun: (sql: string) => void;
}) {
    const editor = useRef<SqlEditorHandle>(null);
    const schema = Object.fromEntries(
        sources.map((item) => [item.table, item.columns.map((column) => column.name)]),
    );
    return (
        <div className="@container flex flex-col gap-3">
            <div className="grid gap-3 @2xl:grid-cols-[minmax(0,1fr)_14rem]">
                <SqlEditor
                    ref={editor}
                    value={draft.sql}
                    onValueChange={(sql) => onChange({ ...draft, sql })}
                    onRun={onRun}
                    schema={schema}
                    diagnostics={problem?.diagnostics}
                    minLines={12}
                    maxLines={32}
                    aria-label="SQL"
                    placeholder="SELECT text AS input, category AS label FROM tickets WHERE category IS NOT NULL"
                />
                <TableList sources={sources} onInsert={(name) => editor.current?.insert(name)} />
            </div>
            <p className="text-sm text-muted-foreground">
                Return columns named <span className="font-mono">input</span> and{" "}
                <span className="font-mono">label</span>; other columns are kept in each version.
                Join, union, filter and clean up with DuckDB SQL. The preview runs when you stop
                typing; Cmd/Ctrl+Enter runs it at once. Queries are read-only and cannot reach other
                files or the network.
            </p>
        </div>
    );
}

function ColumnsMode({
    draft,
    sources,
    onChange,
}: {
    draft: Draft;
    sources: SourceSummary[];
    onChange: (draft: Draft) => void;
}) {
    const chosen = sourceOf(draft, sources);
    const columns = (chosen?.columns ?? []).map((column) => ({
        value: column.name,
        label: column.name,
        description: typeWord(column.type),
    }));
    return (
        <FormRows labels="compact">
            <ColumnSelect
                id="dataset-source"
                label="Source"
                value={draft.source}
                placeholder="Pick a source"
                options={sources.map((item) => ({
                    value: String(item.id),
                    label: item.name,
                    description: item.table,
                }))}
                onChange={(next) =>
                    onChange({
                        ...pickedDraft(sources.find((item) => String(item.id) === next)),
                        sql: draft.sql,
                    })
                }
            />
            <ColumnSelect
                id="dataset-input"
                label="Input"
                value={draft.input}
                placeholder="Pick a column"
                options={columns}
                onChange={(input) => onChange({ ...draft, input })}
                disabled={!chosen}
            />
            <ColumnSelect
                id="dataset-label"
                label="Label"
                value={draft.label}
                placeholder="Pick a column"
                options={columns}
                onChange={(label) => onChange({ ...draft, label })}
                disabled={!chosen}
            />
        </FormRows>
    );
}

export function QueryEditor({
    draft,
    sources,
    problem,
    onChange,
    onRun,
}: {
    draft: Draft;
    sources: SourceSummary[];
    problem: SqlProblem | null;
    onChange: (draft: Draft) => void;
    onRun: (sql: string) => void;
}) {
    const switchMode = (next: string) => {
        const seeded = next === "sql" && !draft.sql.trim() ? draftSql(draft, sources) : null;
        onChange({ ...draft, mode: next as Mode, sql: seeded ?? draft.sql });
    };
    return (
        <div className={`flex min-w-0 flex-col ${FORM_ROW_GAP}`}>
            <SegmentedTabs tabs={MODES} active={draft.mode} onSelect={switchMode} />
            {draft.mode === "sql" ? (
                <SqlMode
                    draft={draft}
                    sources={sources}
                    problem={problem}
                    onChange={onChange}
                    onRun={onRun}
                />
            ) : (
                <ColumnsMode draft={draft} sources={sources} onChange={onChange} />
            )}
        </div>
    );
}
