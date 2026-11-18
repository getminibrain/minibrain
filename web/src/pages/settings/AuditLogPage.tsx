import {
    IconChevronDown,
    IconChevronLeft,
    IconChevronRight,
    IconDownload,
    IconKey,
    IconRobot,
    IconTerminal2,
    IconUser,
    IconX,
    type TablerIcon,
} from "@tabler/icons-react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import {
    Badge,
    Button,
    CheckboxSelect,
    Collapsible,
    CollapsibleContent,
    CollapsibleTrigger,
    DataGrid,
    DataGridDetail,
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
    Input,
    Label,
    Link,
    SearchInput,
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
    Sheet,
    SheetContent,
    SheetDescription,
    SheetHeader,
    SheetTitle,
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "obp-ui";
import { useEffect, useMemo, useState } from "react";
import { api, unwrap } from "~/api/client";
import type { components, operations } from "~/api/schema";
import { SectionError } from "~/components/ErrorState";
import { type Fact, Facts } from "~/components/Facts";
import { ErrorLine } from "~/components/Section";
import { SettingsLayout } from "~/components/SettingsLayout";
import {
    AUDIT_KEYS,
    AUDIT_PATH,
    type AuditEvent,
    type AuditQuery,
    CUSTOM_RANGE,
    RANGES,
    actionLabel,
    actorLabel,
    actorOf,
    auditQuery,
    categoryLabel,
    changesOf,
    exportHref,
    keyLabel,
    otherFields,
    plainValue,
    resultOf,
    summaryOf,
    targetHref,
    targetLabel,
    utcTime,
} from "~/lib/audit";
import { count } from "~/lib/format";
import { splitList, useListSearch } from "~/lib/listSearch";
import { type ListSort, sortFrom, sortSearch, sortingOf } from "~/lib/listSort";
import { exactTime, relativeTime } from "~/lib/time";
import { AuditStatus, RETENTION } from "~/pages/settings/AuditSettings";

type PolicyInfo = components["schemas"]["PolicyInfo"];
type Policies = Map<string, PolicyInfo>;
type AuditSearchKey = (typeof AUDIT_KEYS)[number];

type AuditSortKey = NonNullable<
    NonNullable<operations["list_events_api_audit_get"]["parameters"]["query"]>["sort"]
>;
type AuditSort = ListSort<AuditSortKey>;

const AUDIT_SORTS: AuditSortKey[] = ["at", "actor", "action"];
const NEWEST_EVENTS: AuditSort = { sort: "at", order: "desc" };
const PAGE_SIZE = 50;
const SEARCH_DELAY_MS = 300;
const ALL_TIME = "all";

const ACTOR_ICONS: Record<AuditEvent["actor_kind"], TablerIcon> = {
    user: IconUser,
    api_key: IconKey,
    command_line: IconTerminal2,
    system: IconRobot,
};

function usePolicies() {
    return useQuery({ queryKey: ["policies"], queryFn: () => unwrap(api.GET("/api/policies")) });
}

function useAuditPage(query: AuditQuery, sort: AuditSort, prev?: string, next?: string) {
    return useQuery({
        queryKey: ["audit", "page", query, sort, prev ?? "", next ?? ""],
        queryFn: () =>
            unwrap(
                api.GET("/api/audit", {
                    params: {
                        query: {
                            ...query,
                            prev: prev || undefined,
                            next: next || undefined,
                            sort: sort.sort,
                            order: sort.order,
                            limit: PAGE_SIZE,
                        },
                    },
                }),
            ),
        placeholderData: keepPreviousData,
    });
}

function ActorCell({ event }: { event: AuditEvent }) {
    const Icon = ACTOR_ICONS[event.actor_kind];
    return (
        <span className="flex min-w-0 items-center gap-2">
            <Icon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
            <span className="truncate">{actorOf(event)}</span>
        </span>
    );
}

function TargetCell({ event, policies }: { event: AuditEvent; policies: Policies }) {
    const label = targetLabel(event, policies);
    const href = targetHref(event);
    if (href) {
        return (
            <Link
                href={href}
                onClick={(click) => click.stopPropagation()}
                className="block min-w-0 truncate text-primary hover:underline"
            >
                {label}
            </Link>
        );
    }
    return (
        <span className="flex min-w-0 items-baseline gap-2">
            <span className="truncate">{label}</span>
            {event.target_ref && !event.target_ref.live && (
                <span className="shrink-0 text-sm text-muted-foreground">deleted</span>
            )}
        </span>
    );
}

function ResultCell({ event }: { event: AuditEvent }) {
    const result = resultOf(event);
    return result.failed ? (
        <Badge variant="destructive">{result.label}</Badge>
    ) : (
        <span className="text-muted-foreground">{result.label}</span>
    );
}

function auditColumns(policies: Policies): ColumnDef<AuditEvent, unknown>[] {
    return [
        {
            id: "at",
            header: "Time",
            accessorFn: (event) => new Date(event.at).getTime(),
            cell: ({ row }) => (
                <span title={utcTime(row.original.at)} className="whitespace-nowrap tabular-nums">
                    {relativeTime(row.original.at)}
                </span>
            ),
        },
        {
            id: "actor",
            header: "Actor",
            accessorFn: (event) => actorOf(event).toLowerCase(),
            cell: ({ row }) => <ActorCell event={row.original} />,
        },
        {
            id: "action",
            header: "Action",
            accessorFn: (event) => event.action,
            cell: ({ row }) => (
                <div className="flex min-w-0 flex-col">
                    <span>{actionLabel(row.original.action)}</span>
                    <DataGridDetail className="line-clamp-1 whitespace-normal break-words text-muted-foreground">
                        {summaryOf(row.original, policies)}
                    </DataGridDetail>
                </div>
            ),
        },
        {
            id: "target",
            header: "Target",
            cell: ({ row }) => <TargetCell event={row.original} policies={policies} />,
        },
        {
            id: "result",
            header: "Result",
            cell: ({ row }) => <ResultCell event={row.original} />,
        },
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

function DateFilter({
    label,
    value,
    min,
    max,
    onChange,
}: {
    label: string;
    value: string;
    min?: string;
    max?: string;
    onChange: (value: string) => void;
}) {
    return (
        <Label className="flex items-center gap-2 font-normal">
            <span className="text-muted-foreground">{label}</span>
            <Input
                type="date"
                value={value}
                min={min}
                max={max}
                onChange={(event) => onChange(event.target.value)}
                className="w-40 tabular-nums"
            />
        </Label>
    );
}

function RangeSelect({ value, onChange }: { value: string; onChange: (value: string) => void }) {
    return (
        <Select value={value} onValueChange={(next) => next && onChange(String(next))}>
            <SelectTrigger aria-label="Time range" className="w-40">
                <SelectValue />
            </SelectTrigger>
            <SelectContent>
                <SelectItem value={ALL_TIME}>All time</SelectItem>
                {RANGES.map(([range, label]) => (
                    <SelectItem key={range} value={range}>
                        {label}
                    </SelectItem>
                ))}
                <SelectItem value={CUSTOM_RANGE}>Custom dates</SelectItem>
            </SelectContent>
        </Select>
    );
}

function ExportMenu({ query }: { query: AuditQuery }) {
    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button variant="outline">
                    <IconDownload />
                    Export
                    <IconChevronDown aria-hidden />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
                <DropdownMenuItem asChild>
                    <a href={exportHref(query, "csv")} download>
                        CSV
                    </a>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                    <a href={exportHref(query, "jsonl")} download>
                        JSONL
                    </a>
                </DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>
    );
}

function Pager({
    page,
    byTime,
    onPrevious,
    onNext,
}: {
    page: components["schemas"]["AuditPage"];
    byTime: boolean;
    onPrevious: () => void;
    onNext: () => void;
}) {
    const first = page.start + 1;
    const last = page.start + page.events.length;
    return (
        <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-muted-foreground tabular-nums">
                {page.total === 0
                    ? "No events"
                    : `${count(first)}–${count(last)} of ${count(page.total)}`}
            </p>
            <div className="flex items-center gap-2">
                <Button variant="outline" disabled={page.prev_cursor === null} onClick={onPrevious}>
                    <IconChevronLeft />
                    {byTime ? "Newer" : "Previous"}
                </Button>
                <Button variant="outline" disabled={page.next_cursor === null} onClick={onNext}>
                    {byTime ? "Older" : "Next"}
                    <IconChevronRight />
                </Button>
            </div>
        </div>
    );
}

function ChangeTable({ event, policies }: { event: AuditEvent; policies: Policies }) {
    const changes = changesOf(event, policies);
    if (changes.length === 0) {
        return null;
    }
    return (
        <section className="flex flex-col gap-2">
            <h3 className="font-medium">Change</h3>
            <div className="overflow-x-auto rounded-md border">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>Field</TableHead>
                            <TableHead>Before</TableHead>
                            <TableHead>After</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {changes.map((change) => (
                            <TableRow key={change.field}>
                                <TableCell className="text-muted-foreground">
                                    {change.field}
                                </TableCell>
                                <TableCell className="whitespace-normal break-words">
                                    {change.before}
                                </TableCell>
                                <TableCell className="whitespace-normal break-words">
                                    {change.after}
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </div>
        </section>
    );
}

function Hash({ value }: { value: string | null | undefined }) {
    return value ? (
        <span className="font-mono break-all">{value}</span>
    ) : (
        <span className="text-muted-foreground">Not sealed yet</span>
    );
}

const TIPS = {
    targetId: "The internal key of the target.",
    sequence: "Position in the log. Numbers never skip, so a gap means an entry was removed.",
    hash: "SHA-256 of this entry and the previous hash. Any change to the entry changes it.",
    previous: "Hash of the entry before. It links the log into a chain an edit would break.",
};

function Integrity({ event }: { event: AuditEvent }) {
    const facts: Fact[] = [
        [
            "Sequence",
            event.seq === null ? (
                <span key="seq" className="text-muted-foreground">
                    Not sealed yet
                </span>
            ) : (
                <span key="seq" className="tabular-nums">
                    {count(event.seq)}
                </span>
            ),
            TIPS.sequence,
        ],
        ["Hash", <Hash key="hash" value={event.hash} />, TIPS.hash],
        ["Previous hash", <Hash key="prev" value={event.prev_hash} />, TIPS.previous],
    ];
    return (
        <Collapsible className="flex flex-col gap-2">
            <CollapsibleTrigger className="self-start">Integrity</CollapsibleTrigger>
            <CollapsibleContent>
                <Facts items={facts} />
            </CollapsibleContent>
        </Collapsible>
    );
}

function EventBody({ event, policies }: { event: AuditEvent; policies: Policies }) {
    const target = targetLabel(event, policies);
    const facts: Fact[] = [
        [
            "Time",
            <span key="at" className="tabular-nums">
                {`${exactTime(event.at)} (${relativeTime(event.at)})`}
            </span>,
        ],
        ["Actor", actorOf(event)],
        [
            "IP address",
            <span key="ip" className={event.ip ? "tabular-nums" : "text-muted-foreground"}>
                {event.ip ?? "Not recorded"}
            </span>,
        ],
        [
            "Action",
            <span key="action" className="font-mono">
                {event.action}
            </span>,
        ],
        ["Target", target],
    ];
    if (target !== event.target) {
        facts.push([
            "Target id",
            <span key="target" className="font-mono break-all">
                {event.target}
            </span>,
            TIPS.targetId,
        ]);
    }
    const fields = otherFields(event).filter(
        ([name]) => name !== "name" || target !== event.detail.name,
    );
    return (
        <div className="flex min-w-0 flex-col gap-6">
            <Facts items={facts} />
            <ChangeTable event={event} policies={policies} />
            {fields.length > 0 && (
                <section className="flex flex-col gap-2">
                    <h3 className="font-medium">Details</h3>
                    <Facts
                        items={fields.map(([name, value]) => [
                            keyLabel(name),
                            <span key={name} className="whitespace-pre-wrap break-words">
                                {plainValue(value, undefined, name)}
                            </span>,
                        ])}
                    />
                </section>
            )}
            <Integrity event={event} />
        </div>
    );
}

function EventSheet({
    id,
    loaded,
    policies,
    onClose,
    onTarget,
}: {
    id: number | null;
    loaded: AuditEvent | undefined;
    policies: Policies;
    onClose: () => void;
    onTarget: (target: string) => void;
}) {
    const fetched = useQuery({
        queryKey: ["audit", "event", id],
        queryFn: () =>
            unwrap(api.GET("/api/audit/{event_id}", { params: { path: { event_id: id ?? 0 } } })),
        enabled: id !== null && loaded === undefined,
    });
    const event = loaded ?? fetched.data;
    const href = event ? targetHref(event) : undefined;
    return (
        <Sheet open={id !== null} onOpenChange={(open) => !open && onClose()}>
            <SheetContent className="flex flex-col gap-6 overflow-y-auto sm:max-w-xl">
                <SheetHeader>
                    <SheetTitle>{event ? actionLabel(event.action) : `Event ${id}`}</SheetTitle>
                    <SheetDescription>
                        {event
                            ? `${targetLabel(event, policies)} · ${actorOf(event)} · ${relativeTime(event.at)}`
                            : fetched.error
                              ? null
                              : "Loading…"}
                    </SheetDescription>
                </SheetHeader>
                {!event && <SectionError error={fetched.error} retry={fetched.refetch} />}
                {event && (
                    <div className="flex flex-wrap gap-2">
                        {href && (
                            <Button variant="outline" asChild>
                                <Link href={href}>Open target</Link>
                            </Button>
                        )}
                        {event.target_ref && (
                            <Button
                                variant="outline"
                                onClick={() => event.target_ref && onTarget(event.target_ref.key)}
                            >
                                All events for this target
                            </Button>
                        )}
                    </div>
                )}
                {event && (
                    <div className="pb-panel">
                        <EventBody event={event} policies={policies} />
                    </div>
                )}
            </SheetContent>
        </Sheet>
    );
}

export function AuditLogPage() {
    const { search, update } = useListSearch(AUDIT_PATH, AUDIT_KEYS);
    const query = useMemo(() => auditQuery(search), [search]);
    const sort = sortFrom(AUDIT_SORTS, NEWEST_EVENTS, search);
    const page = useAuditPage(query, sort, search.prev, search.next);
    const policiesQuery = usePolicies();
    const facets = useQuery({
        queryKey: ["audit", "facets"],
        queryFn: () => unwrap(api.GET("/api/audit/facets")),
    });
    const policies: Policies = useMemo(
        () => new Map((policiesQuery.data ?? []).map((policy) => [policy.name, policy])),
        [policiesQuery.data],
    );
    const columns = useMemo(() => auditColumns(policies), [policies]);
    const filter = (patch: Partial<Record<AuditSearchKey, string>>) =>
        update({ ...patch, prev: "", next: "" });
    const [draft, setDraft] = useDebounced(search.q ?? "", (q) => filter({ q }));
    const categories = splitList(search.category);
    const actors = splitList(search.actor);
    const range = search.range || ALL_TIME;
    const filtering = Boolean(
        search.q ||
            search.category ||
            search.action ||
            search.actor ||
            search.target ||
            search.range,
    );
    const clear = () =>
        filter({
            q: "",
            category: "",
            action: "",
            actor: "",
            target: "",
            range: "",
            from: "",
            to: "",
        });
    const eventId =
        search.event && Number.isInteger(Number(search.event)) ? Number(search.event) : null;
    const loaded = page.data?.events.find((event) => event.id === eventId);
    return (
        <SettingsLayout
            title="Audit log"
            caption="Who changed what on this install, and when."
            actions={<ExportMenu query={query} />}
        >
            <div className="flex flex-col gap-3">
                <AuditStatus policy={policies.get(RETENTION)} />
                <div className="flex flex-wrap items-center gap-2">
                    <SearchInput
                        aria-label="Search the audit log"
                        placeholder="Search"
                        value={draft}
                        onValueChange={setDraft}
                        className="w-56"
                    />
                    <CheckboxSelect
                        label="Area"
                        allLabel="All areas"
                        noun="areas"
                        options={(facets.data?.categories ?? []).map((item) => ({
                            value: item.value,
                            label: categoryLabel(item.value),
                            count: item.count,
                        }))}
                        value={categories}
                        onValueChange={(next) => filter({ category: next.join(","), action: "" })}
                    />
                    <CheckboxSelect
                        label="Actor"
                        allLabel="All actors"
                        noun="actors"
                        options={(facets.data?.actors ?? []).map((item) => ({
                            value: item.value,
                            label: actorLabel(item.value),
                            count: item.count,
                        }))}
                        value={actors}
                        onValueChange={(next) => filter({ actor: next.join(",") })}
                    />
                    <RangeSelect
                        value={range}
                        onChange={(next) =>
                            filter({ range: next === ALL_TIME ? "" : next, from: "", to: "" })
                        }
                    />
                    {range === CUSTOM_RANGE && (
                        <div className="flex flex-wrap items-center gap-2">
                            <DateFilter
                                label="From"
                                value={search.from ?? ""}
                                max={search.to}
                                onChange={(from) => filter({ from })}
                            />
                            <DateFilter
                                label="To"
                                value={search.to ?? ""}
                                min={search.from}
                                onChange={(to) => filter({ to })}
                            />
                        </div>
                    )}
                    {search.target && (
                        <Button variant="outline" onClick={() => filter({ target: "" })}>
                            <span className="text-muted-foreground">Target</span>
                            <span className="font-mono">{search.target}</span>
                            <IconX aria-hidden />
                        </Button>
                    )}
                    {filtering && (
                        <Button variant="ghost" onClick={clear}>
                            Clear filters
                        </Button>
                    )}
                </div>
                <ErrorLine error={(page.data ? page.error : null) ?? facets.error} />
                <DataGrid
                    columns={columns}
                    rows={page.data?.events ?? []}
                    getRowId={(event) => String(event.id)}
                    loading={page.isLoading}
                    sorting={sortingOf(sort)}
                    onSortingChange={(next) => filter(sortSearch(next, NEWEST_EVENTS))}
                    storageKey="minibrain.audit.columns.v2"
                    onOpen={(event) => update({ event: String(event.id) })}
                    rowLabel={(event) =>
                        `${actionLabel(event.action)}, ${targetLabel(event, policies)}, ${exactTime(event.at)}`
                    }
                    minWidth="min-w-[760px]"
                    empty={
                        page.error && !page.data ? (
                            <SectionError error={page.error} retry={page.refetch} />
                        ) : filtering ? (
                            <div className="flex flex-wrap items-center gap-2">
                                <p className="text-muted-foreground">No events match.</p>
                                <Button variant="outline" onClick={clear}>
                                    Clear filters
                                </Button>
                            </div>
                        ) : (
                            <p className="text-muted-foreground">No events yet.</p>
                        )
                    }
                />
                {page.data && page.data.total > 0 && (
                    <Pager
                        page={page.data}
                        byTime={sort.sort === "at"}
                        onPrevious={() => update({ next: "", prev: page.data?.prev_cursor ?? "" })}
                        onNext={() => update({ prev: "", next: page.data?.next_cursor ?? "" })}
                    />
                )}
            </div>
            <EventSheet
                id={eventId}
                loaded={loaded}
                policies={policies}
                onClose={() => update({ event: "" })}
                onTarget={(target) => filter({ target, event: "" })}
            />
        </SettingsLayout>
    );
}
