import { IconChevronDown, IconMessage, IconTag } from "@tabler/icons-react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import {
    DataGrid,
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
    Tooltip,
    TooltipContent,
    TooltipTrigger,
    cn,
} from "obp-ui";
import { useEffect, useState } from "react";
import { type QueryResponse, api, unwrap } from "~/api/client";
import type { components } from "~/api/schema";
import { StatusText, type Tone } from "~/components/models/StatusText";
import { count } from "~/lib/format";
import { TrainingExample, rowSummary } from "./DatasetDetail";
import { RowsPreview } from "./RowsPreview";
import { resultColumns } from "./resultColumns";

export type QueryShape = components["schemas"]["QueryShapeInfo"];
type CheckInfo = components["schemas"]["CheckInfo"];
type PairColumn = QueryShape["missing"][number];

const PREVIEW_ROWS = 50;
const SETTLE_MS = 500;
const PAIR: PairColumn[] = ["input", "label"];
const WARNING_TONES: Partial<Record<CheckInfo["status"], Tone>> = {
    warning: "warning",
    blocked: "destructive",
};

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

export function useSettled(live: string | null, immediate: boolean) {
    const [settled, setSettled] = useState(live);
    useEffect(() => {
        if (immediate) {
            setSettled(live);
            return;
        }
        const timer = window.setTimeout(() => setSettled(live), SETTLE_MS);
        return () => window.clearTimeout(timer);
    }, [live, immediate]);
    return { settled, runNow: (text: string) => setSettled(text.trim() || null) };
}

export function useLivePreview(sql: string | null, dataset: string | null) {
    const [run] = useState(runName);
    const rowsRun = `${run}.rows`;
    const shapeRun = `${run}.shape`;
    const rows = useQuery({
        queryKey: ["query-preview", dataset, sql, "rows"],
        queryFn: ({ signal }) => fetchRows(dataset, sql ?? "", rowsRun, signal),
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

function Warning({ check }: { check: CheckInfo }) {
    return (
        <Tooltip>
            <TooltipTrigger asChild>
                <span className="shrink-0 cursor-default">
                    <StatusText tone={WARNING_TONES[check.status] ?? "warning"}>
                        {check.title}
                    </StatusText>
                </span>
            </TooltipTrigger>
            <TooltipContent className="max-w-sm whitespace-normal">{check.detail}</TooltipContent>
        </Tooltip>
    );
}

function plain(value: number, noun: string): string {
    return `${count(value)} ${noun}${value === 1 ? "" : "s"}`;
}

function shapeFacts(shape: QueryShape, quality: NonNullable<QueryShape["quality"]>): string {
    return [
        plain(shape.rows, "row"),
        plain(quality.labels, "label"),
        shape.largest_share === null ? null : `largest ${Math.round(shape.largest_share * 100)}%`,
        `${count(quality.empty)} empty`,
        `${count(quality.duplicates)} repeated`,
    ]
        .filter(Boolean)
        .join(" · ");
}

function ShapeStrip({ preview }: { preview: LivePreview }) {
    const { shape, missing } = preview;
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
    const { quality } = shape;
    const warnings = (shape.checks ?? []).filter(
        (check) => WARNING_TONES[check.status] && !check.dismissed,
    );
    return (
        <>
            <Tooltip>
                <TooltipTrigger asChild>
                    <span
                        className={cn(
                            "min-w-0 cursor-default truncate tabular-nums",
                            preview.counting && "text-muted-foreground",
                        )}
                    >
                        {shapeFacts(shape, quality)}
                    </span>
                </TooltipTrigger>
                <TooltipContent className="tabular-nums">
                    {`${shapeFacts(shape, quality)}. Empty and repeated inputs are left out when the version is saved.`}
                </TooltipContent>
            </Tooltip>
            {warnings.map((check) => (
                <Warning key={check.check} check={check} />
            ))}
        </>
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

export function QueryPreviewPanel({
    preview,
    idle,
    pickable,
    onPick,
}: {
    preview: LivePreview;
    idle: string;
    pickable?: string[];
    onPick?: (column: string, role: Role) => void;
}) {
    const { result } = preview;
    const records = recordsOf(result);
    const paired = preview.missing.length === 0 && Boolean(result?.columns.includes("input"));
    const empty = preview.sql === null ? idle : "The query returned no rows.";
    const loading = preview.sql !== null && !result && preview.running;
    return (
        <RowsPreview
            records={records}
            total={preview.counted?.rows}
            counting={preview.counting && !preview.counted}
            loading={loading}
            error={preview.error}
            marked={["label"]}
            summary={paired ? rowSummary : undefined}
            empty={empty}
            strip={<ShapeStrip preview={preview} />}
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
