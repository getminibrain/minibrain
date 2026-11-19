import { IconChevronDown, IconMessage, IconTag } from "@tabler/icons-react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import {
    Button,
    DataGrid,
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
    cn,
} from "obp-ui";
import { useEffect, useState } from "react";
import { type QueryResponse, api, unwrap } from "~/api/client";
import type { components } from "~/api/schema";
import { StatusText } from "~/components/models/StatusText";
import { count, errorText } from "~/lib/format";
import { sqlMessage } from "~/lib/sqlError";
import { TrainingExample, rowSummary } from "./DatasetDetail";
import {
    type Finding,
    type Fix,
    type FixContext,
    type FixEffect,
    QualityTab,
    toLookAt,
    verdictOf,
} from "./QualityTab";
import { RowsPreview, type View } from "./RowsPreview";
import { resultColumns } from "./resultColumns";

export type QueryShape = components["schemas"]["QueryShapeInfo"];
type PairColumn = QueryShape["missing"][number];

const PREVIEW_ROWS = 50;
const SETTLE_MS = 500;
export const AUTO_RUN_ROWS = 1_000_000;
const PAIR: PairColumn[] = ["input", "label"];

function runName(): string {
    return `editor-${Math.random().toString(36).slice(2, 12)}`;
}

function stopRun(run: string) {
    api.DELETE("/api/query/runs/{run}", { params: { path: { run } } }).catch(() => undefined);
}

function fetchRows(dataset: string | null, sql: string, run: string, signal: AbortSignal) {
    const body = { sql, run, rows: PREVIEW_ROWS };
    return unwrap(
        dataset
            ? api.POST("/api/datasets/{slug}/query", {
                  params: { path: { slug: dataset } },
                  body,
                  signal,
              })
            : api.POST("/api/query", { body, signal }),
    );
}

function fetchShape(dataset: string | null, sql: string, run: string, signal: AbortSignal) {
    const body = { sql, run };
    return unwrap(
        dataset
            ? api.POST("/api/datasets/{slug}/query/shape", {
                  params: { path: { slug: dataset } },
                  body,
                  signal,
              })
            : api.POST("/api/query/shape", { body, signal }),
    );
}

export function useSettled(
    live: string | null,
    immediate: boolean,
    auto: boolean,
    paused: boolean,
) {
    const [settled, setSettled] = useState(auto ? live : null);
    const [asked, setAsked] = useState<string | null>(null);
    useEffect(() => {
        if (!auto) {
            return;
        }
        if (immediate) {
            setSettled(live);
            return;
        }
        if (paused) {
            return;
        }
        const timer = window.setTimeout(() => setSettled(live), SETTLE_MS);
        return () => window.clearTimeout(timer);
    }, [live, immediate, auto, paused]);
    return {
        settled,
        stale: !auto && live !== null && live !== (asked ?? settled),
        runNow: (text: string, from: string | null = text) => {
            setSettled(text.trim() || null);
            setAsked(from);
        },
    };
}

export function useLivePreview(
    sql: string | null,
    dataset: string | null,
    filtered: string | null = null,
) {
    const [run] = useState(runName);
    const rowsRun = `${run}.rows`;
    const shapeRun = `${run}.shape`;
    const rowsSql = filtered ?? sql;
    const rows = useQuery({
        queryKey: ["query-preview", dataset, rowsSql, "rows"],
        queryFn: ({ signal }) => fetchRows(dataset, rowsSql ?? "", rowsRun, signal),
        enabled: sql !== null,
        placeholderData: keepPreviousData,
        retry: false,
        staleTime: 60_000,
        gcTime: 60_000,
    });
    const shape = useQuery({
        queryKey: ["query-preview", dataset, sql, "shape"],
        queryFn: ({ signal }) => fetchShape(dataset, sql ?? "", shapeRun, signal),
        enabled: sql !== null,
        placeholderData: keepPreviousData,
        retry: false,
        staleTime: 60_000,
        gcTime: 60_000,
    });
    useEffect(() => {
        if (sql === null) {
            stopRun(rowsRun);
            stopRun(shapeRun);
        }
    }, [sql, rowsRun, shapeRun]);
    useEffect(
        () => () => {
            stopRun(rowsRun);
            stopRun(shapeRun);
        },
        [rowsRun, shapeRun],
    );
    const current = sql !== null;
    const result = current ? rows.data : undefined;
    const counted = current && !shape.isPlaceholderData ? shape.data : undefined;
    return {
        sql,
        filtered: current && filtered !== null,
        rerun: () => {
            rows.refetch();
            shape.refetch();
        },
        result,
        running: current && rows.isFetching,
        error: current && !rows.isPlaceholderData ? rows.error : null,
        shape: current ? shape.data : undefined,
        counted,
        counting: current && shape.isFetching,
        missing: result ? missingColumns(result) : [],
    };
}

export type LivePreview = ReturnType<typeof useLivePreview>;

export function missingColumns(result: QueryResponse): PairColumn[] {
    return result.columns.includes("messages")
        ? []
        : PAIR.filter((name) => !result.columns.includes(name));
}

function missingText(missing: PairColumn[]): string {
    return missing.length === 2
        ? "No input or label column: return columns named input and label"
        : `No ${missing[0]} column: return one named ${missing[0]}`;
}

export function shapeSummary(shape: QueryShape | undefined): string | null {
    if (!shape?.quality) {
        return null;
    }
    return `${plain(shape.rows, "row")} · ${plain(shape.quality.labels, "label")}`;
}

function plain(value: number, noun: string): string {
    return `${count(value)} ${noun}${value === 1 ? "" : "s"}`;
}

function ShapeStrip({
    preview,
    waiting,
    onQuality,
}: {
    preview: LivePreview;
    waiting: string | null;
    onQuality: () => void;
}) {
    const { shape, missing } = preview;
    if (waiting) {
        return <span className="text-muted-foreground">{waiting}</span>;
    }
    if (preview.sql === null) {
        return <span className="text-muted-foreground">No query to run yet</span>;
    }
    if (missing.length > 0) {
        return <StatusText tone="warning">{missingText(missing)}</StatusText>;
    }
    if (!shape?.quality) {
        return preview.counting ? (
            <span className="text-muted-foreground">Counting rows…</span>
        ) : null;
    }
    const verdict = shape.checks ? verdictOf(shape.checks) : null;
    return (
        <span
            className={cn(
                "flex min-w-0 items-center gap-2 tabular-nums",
                preview.counting && "text-muted-foreground",
            )}
        >
            <span className="shrink-0">{shapeSummary(shape)}</span>
            {verdict && (
                <>
                    <span aria-hidden="true" className="text-muted-foreground">
                        ·
                    </span>
                    <button
                        type="button"
                        onClick={onQuality}
                        className="min-w-0 rounded-sm outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                    >
                        <StatusText tone={verdict.tone} className="min-w-0">
                            <span className="truncate">{verdict.text}</span>
                        </StatusText>
                    </button>
                </>
            )}
        </span>
    );
}

function recordsOf(result: QueryResponse | undefined): Record<string, string | null>[] {
    if (!result) {
        return [];
    }
    return result.rows.map((row) =>
        Object.fromEntries(result.columns.map((column, index) => [column, row[index]])),
    );
}

type Role = "input" | "label";

function RoleMenu({
    name,
    onPick,
}: { name: string; onPick: (column: string, role: Role) => void }) {
    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <button
                    type="button"
                    aria-label={`Use ${name} as`}
                    className="inline-flex items-center gap-1 rounded-md font-mono outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                >
                    {name}
                    <IconChevronDown className="size-3.5 text-muted-foreground" />
                </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-48">
                <DropdownMenuItem onSelect={() => onPick(name, "input")}>
                    <IconMessage />
                    Use as text
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => onPick(name, "label")}>
                    <IconTag />
                    Use as answer
                </DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>
    );
}

export type Focus = { check: string; title: string; rows: number; majority: string | null };

export type QualityProps = {
    dataset: string | null;
    context: FixContext;
    effect: FixEffect | null;
    focus: Focus | null;
    canFix: boolean;
    onShowRows: (check: Finding) => void;
    onShowAll: () => void;
    onFix: (fix: Fix) => void;
};

function FocusBar({ focus, onShowAll }: { focus: Focus; onShowAll: () => void }) {
    return (
        <>
            <span className="min-w-0 truncate tabular-nums">
                {`Showing ${plain(focus.rows, "row")} with ${focus.title.toLowerCase()}`}
            </span>
            <Button variant="link" size="sm" className="h-auto px-0" onClick={onShowAll}>
                Show all
            </Button>
        </>
    );
}

export function QueryPreviewPanel({
    preview,
    idle,
    waiting,
    pickable,
    onPick,
    quality,
}: {
    preview: LivePreview;
    idle: string;
    waiting: string | null;
    pickable?: string[];
    onPick?: (column: string, role: Role) => void;
    quality: QualityProps;
}) {
    const [view, setView] = useState<View>("records");
    const [rowsView, setRowsView] = useState<View>("records");
    const choose = (next: View) => {
        setView(next);
        if (next === "records" || next === "table") {
            setRowsView(next);
        }
    };
    const { result } = preview;
    const records = recordsOf(result);
    const paired = preview.missing.length === 0 && Boolean(result?.columns.includes("input"));
    const actionable =
        paired && Boolean(result?.columns.includes("label")) && quality.canFix && !preview.filtered;
    const empty = preview.sql === null ? (waiting ?? idle) : "The query returned no rows.";
    const loading = preview.sql !== null && !result && preview.running;
    const focus = preview.filtered ? quality.focus : null;
    const badge = preview.counted?.checks ? toLookAt(preview.counted.checks).length : 0;
    return (
        <RowsPreview
            records={records}
            total={focus ? focus.rows : preview.counted?.rows}
            counting={preview.counting && !preview.counted}
            idle={preview.sql === null}
            loading={loading}
            error={preview.error}
            errorText={preview.error ? sqlMessage(errorText(preview.error)) : undefined}
            marked={["label"]}
            summary={paired ? rowSummary : undefined}
            empty={empty}
            view={view}
            onView={choose}
            strip={
                <ShapeStrip
                    preview={preview}
                    waiting={waiting}
                    onQuality={() => choose("quality")}
                />
            }
            bar={focus ? <FocusBar focus={focus} onShowAll={quality.onShowAll} /> : undefined}
            qualityBadge={badge}
            quality={
                <QualityTab
                    shape={preview.counted}
                    counting={preview.counting}
                    dataset={quality.dataset}
                    actionable={actionable}
                    context={quality.context}
                    effect={quality.effect}
                    onShowRows={(check) => {
                        quality.onShowRows(check);
                        choose(rowsView);
                    }}
                    onFix={quality.onFix}
                />
            }
            table={
                result ? (
                    <DataGrid
                        columns={resultColumns(result, (name) =>
                            onPick && pickable?.includes(name) ? (
                                <RoleMenu name={name} onPick={onPick} />
                            ) : null,
                        )}
                        rows={result.rows}
                        maxHeight="100%"
                        minWidth={result.columns.length > 4 ? "min-w-[960px]" : undefined}
                        empty={empty}
                    />
                ) : (
                    <p className="px-3 py-2 text-muted-foreground">
                        {loading ? "Loading rows…" : empty}
                    </p>
                )
            }
            example={<TrainingExample data={preview.shape} />}
        />
    );
}
