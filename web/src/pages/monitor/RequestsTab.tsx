import { IconThumbDown, IconThumbUp } from "@tabler/icons-react";
import type { ColumnDef } from "@tanstack/react-table";
import {
    Button,
    Card,
    CheckboxSelect,
    DataGrid,
    Link,
    SearchInput,
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
    Tooltip,
    TooltipContent,
    TooltipTrigger,
} from "obp-ui";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import {
    NEWEST_REQUESTS,
    type RequestFilter,
    type RequestRow,
    type RequestSortKey,
    type RequestSummary,
    useRequestFacets,
    useRequestList,
    useRequestSummary,
} from "~/api/requestQueries";
import { SectionError } from "~/components/ErrorState";
import { ModelName, withDeleted } from "~/components/ModelName";
import { modelOption } from "~/components/PublisherLogo";
import { ErrorLine } from "~/components/Section";
import { StatusText } from "~/components/models/StatusText";
import { count, milliseconds, percent } from "~/lib/format";
import { splitList, useListSearch } from "~/lib/listSearch";
import { isDefaultSort, sortFrom, sortSearch, sortingOf } from "~/lib/listSort";
import {
    DEFAULT_RANGE,
    RANGES,
    REQUESTS_PATH,
    REQUEST_KEYS,
    REQUEST_KINDS,
    STATUS_CLASSES,
    STATUS_TONES,
    type StatusClass,
    clockTime,
    modelLabel,
    rangeOf,
} from "~/lib/requests";
import { exactTime, relativeTime } from "~/lib/time";
import { RequestDialog } from "./RequestDetail";

const SEARCH_DELAY_MS = 300;
const REQUEST_SORTS: RequestSortKey[] = [
    "at",
    "model",
    "kind",
    "key",
    "status",
    "latency",
    "tokens",
];

type FacetOption = {
    value: string;
    label: string;
    count: number;
    publisher?: string | null;
    deleted?: boolean;
};

function versionOption(option: FacetOption) {
    return {
        ...option,
        label: <ModelName name={option.label} deleted={option.deleted} />,
        text: withDeleted(option.label, option.deleted),
    };
}

function Muted({ children }: { children: ReactNode }) {
    return <span className="text-muted-foreground">{children}</span>;
}

function TimeCell({ at }: { at: string }) {
    return (
        <Tooltip>
            <TooltipTrigger asChild>
                <button type="button" className="whitespace-nowrap rounded-sm tabular-nums">
                    <time dateTime={at}>{clockTime(at)}</time>
                </button>
            </TooltipTrigger>
            <TooltipContent>{`${exactTime(at)}, ${relativeTime(at)}`}</TooltipContent>
        </Tooltip>
    );
}

function FeedbackMark({ row }: { row: RequestRow }) {
    if (row.feedback_down === 0 && row.feedback_up === 0) {
        return null;
    }
    return (
        <span className="flex items-center gap-2 tabular-nums">
            {row.feedback_down > 0 && (
                <span className="flex items-center gap-1 text-warning">
                    <IconThumbDown aria-hidden="true" className="size-3.5" />
                    <span className="sr-only">Marked wrong</span>
                    {row.feedback_down > 1 && row.feedback_down}
                </span>
            )}
            {row.feedback_up > 0 && (
                <span className="flex items-center gap-1 text-success">
                    <IconThumbUp aria-hidden="true" className="size-3.5" />
                    <span className="sr-only">Marked right</span>
                    {row.feedback_up > 1 && row.feedback_up}
                </span>
            )}
        </span>
    );
}

export const REQUEST_COLUMNS: ColumnDef<RequestRow, unknown>[] = [
    {
        id: "at",
        header: "Time",
        enableHiding: false,
        accessorFn: (row) => new Date(row.at).getTime(),
        cell: ({ row }) => <TimeCell at={row.original.at} />,
    },
    {
        id: "model",
        header: "Model",
        accessorFn: (row) => modelLabel(row).toLowerCase(),
        cell: ({ row }) => (
            <ModelName
                name={modelLabel(row.original)}
                deleted={row.original.deleted}
                className="block max-w-48 truncate"
            />
        ),
    },
    {
        id: "kind",
        header: "Endpoint",
        accessorFn: (row) => row.kind,
        cell: ({ row }) => REQUEST_KINDS[row.original.kind].label,
    },
    {
        id: "key",
        header: "Key",
        accessorFn: (row) => (row.key_name ?? "").toLowerCase(),
        cell: ({ row }) =>
            row.original.key_name ? (
                <span className="block max-w-40 truncate">{row.original.key_name}</span>
            ) : (
                <Muted>Deleted key</Muted>
            ),
    },
    {
        id: "status",
        header: "Status",
        accessorFn: (row) => row.status,
        cell: ({ row }) => (
            <StatusText tone={STATUS_TONES[row.original.status_class]}>
                <span className="tabular-nums">{row.original.status}</span>
            </StatusText>
        ),
    },
    {
        id: "latency",
        header: "Latency",
        accessorFn: (row) => row.latency_ms,
        cell: ({ row }) => (
            <span className="tabular-nums">{milliseconds(row.original.latency_ms)}</span>
        ),
    },
    {
        id: "tokens",
        header: "Tokens in / out",
        accessorFn: (row) => row.prompt_tokens + row.completion_tokens,
        cell: ({ row }) => (
            <span className="tabular-nums">
                {`${count(row.original.prompt_tokens)} / ${count(row.original.completion_tokens)}`}
            </span>
        ),
    },
    {
        id: "finish",
        header: "Finish",
        cell: ({ row }) =>
            row.original.finish_reason ? row.original.finish_reason : <Muted>–</Muted>,
    },
    {
        id: "response",
        header: "Response ID",
        cell: ({ row }) =>
            row.original.response_id ? (
                <span className="block max-w-52 truncate font-mono text-muted-foreground">
                    {row.original.response_id}
                </span>
            ) : (
                <Muted>–</Muted>
            ),
    },
    {
        id: "feedback",
        header: "Feedback",
        cell: ({ row }) => <FeedbackMark row={row.original} />,
    },
];

function withChosen(options: FacetOption[], chosen: string[]): FacetOption[] {
    const known = new Set(options.map((option) => option.value));
    return [
        ...options,
        ...chosen
            .filter((value) => !known.has(value))
            .map((value) => ({ value, label: value, count: 0 })),
    ];
}

function useDebounced(value: string, onSettle: (value: string) => void) {
    const [draft, setDraft] = useState(value);
    useEffect(() => setDraft(value), [value]);
    useEffect(() => {
        if (draft === value) {
            return;
        }
        const timer = window.setTimeout(() => onSettle(draft), SEARCH_DELAY_MS);
        return () => window.clearTimeout(timer);
    }, [draft, value, onSettle]);
    return [draft, setDraft] as const;
}

export function useRequestsHeld(): string | undefined {
    const { search } = useListSearch(REQUESTS_PATH, REQUEST_KEYS);
    const sort = sortFrom(REQUEST_SORTS, NEWEST_REQUESTS, search);
    return isDefaultSort(sort, NEWEST_REQUESTS) ? undefined : "Paused while sorted";
}

export function LiveControl({
    paused,
    held,
    onToggle,
}: { paused: boolean; held?: string; onToggle: () => void }) {
    const live = !paused && !held;
    return (
        <div className="flex items-center gap-3">
            <StatusText tone={live ? "info" : "neutral"} active={live}>
                {paused ? "Paused" : (held ?? "Live")}
            </StatusText>
            <Button variant="outline" onClick={onToggle} aria-pressed={paused}>
                {paused ? "Resume" : "Pause"}
            </Button>
        </div>
    );
}

export function RangeSelect({
    range,
    onRange,
}: { range: string; onRange: (range: string) => void }) {
    return (
        <Select value={range} onValueChange={(next) => onRange(String(next))}>
            <SelectTrigger aria-label="Time range" className="w-44">
                <SelectValue>{rangeOf(range).label}</SelectValue>
            </SelectTrigger>
            <SelectContent>
                {RANGES.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                        {item.label}
                    </SelectItem>
                ))}
            </SelectContent>
        </Select>
    );
}

function StripStat({ label, children }: { label: string; children: ReactNode }) {
    return (
        <div className="flex min-w-0 flex-col gap-0.5 px-panel py-3">
            <dt className="truncate text-sm text-muted-foreground">{label}</dt>
            <dd className="truncate font-semibold tabular-nums">{children}</dd>
        </div>
    );
}

export function SummaryStrip({
    summary,
    note,
}: {
    summary: RequestSummary | undefined;
    note?: ReactNode;
}) {
    const errors = summary?.errors ?? 0;
    return (
        <Card className="gap-0 overflow-clip py-0">
            <dl className="grid grid-cols-6 divide-x">
                <StripStat label="Requests">{count(summary?.requests)}</StripStat>
                <StripStat label="Error rate">
                    {percent(summary?.error_rate)}
                    {errors > 0 && (
                        <span className="ml-1.5 text-sm font-normal text-muted-foreground">
                            {`${count(errors)} ${errors === 1 ? "error" : "errors"}`}
                        </span>
                    )}
                </StripStat>
                <StripStat label="Latency p50">{milliseconds(summary?.p50_ms)}</StripStat>
                <StripStat label="Latency p95">{milliseconds(summary?.p95_ms)}</StripStat>
                <StripStat label="Tokens in">{count(summary?.prompt_tokens)}</StripStat>
                <StripStat label="Tokens out">{count(summary?.completion_tokens)}</StripStat>
            </dl>
            {note && <div className="border-t px-panel py-3">{note}</div>}
        </Card>
    );
}

export function NothingYet({ summary, range }: { summary: RequestSummary; range: string }) {
    if (summary.last_at) {
        return (
            <p className="text-muted-foreground">
                {`No requests ${rangeOf(range).phrase}. The last one came ${relativeTime(summary.last_at)}; pick a longer time range to see it.`}
            </p>
        );
    }
    return (
        <p className="text-muted-foreground">
            No requests yet. Calls to <span className="font-mono">/v1/chat/completions</span> show
            up here within seconds; create an API key on a model's API tab in{" "}
            <Link href="/models" className="text-primary hover:underline">
                Models
            </Link>
            .
        </p>
    );
}

function requestId(value: string | undefined): number | null {
    const id = Number(value);
    return value && Number.isInteger(id) && id > 0 ? id : null;
}

export function RequestsTab({ paused }: { paused: boolean }) {
    const { search, update } = useListSearch(REQUESTS_PATH, REQUEST_KEYS);
    const range = rangeOf(search.range ?? DEFAULT_RANGE).value;
    const filter: RequestFilter = useMemo(
        () => ({
            model: splitList(search.model),
            version: splitList(search.version),
            key: splitList(search.key),
            status: splitList(search.status).filter((value): value is StatusClass =>
                STATUS_CLASSES.some((item) => item.value === value),
            ),
            q: search.q ?? "",
            range,
        }),
        [search, range],
    );
    const sort = sortFrom(REQUEST_SORTS, NEWEST_REQUESTS, search);
    const list = useRequestList(filter, paused, sort);
    const facets = useRequestFacets(filter, paused);
    const summary = useRequestSummary(filter, paused);
    const [draft, setDraft] = useDebounced(search.q ?? "", (q) => update({ q }));
    const filtering =
        filter.model.length + filter.version.length + filter.key.length + filter.status.length >
            0 || Boolean(filter.q);
    const clear = () => update({ model: "", version: "", key: "", status: "", q: "" });
    const selected = requestId(search.request);
    const loaded = list.rows.find((row) => row.id === selected);
    const statuses = facets.data?.statuses ?? {};
    const empty = list.error ? (
        <SectionError error={list.error} retry={list.retry} />
    ) : filtering ? (
        <div className="flex flex-wrap items-center gap-2">
            <p className="text-muted-foreground">No requests match these filters.</p>
            <Button variant="outline" onClick={clear}>
                Clear filters
            </Button>
        </div>
    ) : summary.data ? (
        <NothingYet summary={summary.data} range={range} />
    ) : null;
    return (
        <>
            <div className="flex flex-wrap items-center gap-2">
                <SearchInput
                    aria-label="Search response IDs"
                    placeholder="Search response IDs"
                    value={draft}
                    onValueChange={setDraft}
                    className="w-full min-w-48 max-w-xs flex-1"
                />
                <CheckboxSelect
                    label="Model"
                    allLabel="All models"
                    noun="models"
                    options={withChosen(facets.data?.models ?? [], filter.model).map(modelOption)}
                    value={filter.model}
                    onValueChange={(next) => update({ model: next.join(",") })}
                />
                <CheckboxSelect
                    label="Version"
                    allLabel="All versions"
                    noun="versions"
                    options={withChosen(facets.data?.versions ?? [], filter.version).map(
                        versionOption,
                    )}
                    value={filter.version}
                    onValueChange={(next) => update({ version: next.join(",") })}
                />
                <CheckboxSelect
                    label="API key"
                    allLabel="All keys"
                    noun="keys"
                    options={withChosen(facets.data?.keys ?? [], filter.key)}
                    value={filter.key}
                    onValueChange={(next) => update({ key: next.join(",") })}
                />
                <CheckboxSelect
                    label="Status"
                    allLabel="All statuses"
                    noun="statuses"
                    options={STATUS_CLASSES.map((item) => ({
                        ...item,
                        count: statuses[item.value] ?? 0,
                    }))}
                    value={filter.status}
                    onValueChange={(next) => update({ status: next.join(",") })}
                />
                {filtering && (
                    <Button variant="ghost" onClick={clear}>
                        Clear filters
                    </Button>
                )}
                <RangeSelect
                    range={range}
                    onRange={(next) => update({ range: next === DEFAULT_RANGE ? "" : next })}
                />
            </div>
            <SummaryStrip summary={summary.data} />
            <ErrorLine
                error={(list.rows.length > 0 ? list.error : null) ?? facets.error ?? summary.error}
            />
            <DataGrid
                columns={REQUEST_COLUMNS}
                rows={list.rows}
                getRowId={(row) => String(row.id)}
                loading={list.isLoading}
                sorting={sortingOf(sort)}
                onSortingChange={(next) => update(sortSearch(next, NEWEST_REQUESTS))}
                storageKey="minibrain.requests.columns"
                columnPicker
                hiddenColumns={["finish", "response"]}
                hasMore={list.hasMore}
                loadingMore={list.loadingMore}
                onLoadMore={list.loadMore}
                total={list.total}
                onOpen={(row) => update({ request: String(row.id) })}
                rowLabel={(row) =>
                    `Request ${row.id}, ${withDeleted(modelLabel(row), row.deleted)}, status ${row.status}, ${exactTime(row.at)}`
                }
                empty={empty}
                minWidth="min-w-[900px]"
            />
            <RequestDialog id={selected} loaded={loaded} onClose={() => update({ request: "" })} />
        </>
    );
}
