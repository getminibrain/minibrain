import { TriangleAlert } from "lucide-react";
import {
    Badge,
    Button,
    FilterMenu,
    type FilterMenuSection,
    Label,
    Link,
    SearchInput,
    Switch,
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
    Tooltip,
    TooltipContent,
    TooltipTrigger,
    cn,
} from "obp-ui";
import { type KeyboardEvent, type MouseEvent, type ReactNode, useState } from "react";
import { PoolLink } from "~/components/PoolLink";
import { BASIS_LABELS, UsageGauge } from "~/components/UsageGauge";
import { StatusText } from "~/components/models/StatusText";
import { count } from "~/lib/format";
import { kindNoun } from "~/lib/jobs";
import { splitList, useListSearch } from "~/lib/listSearch";
import { useScrollToHash } from "~/lib/scrollToHash";
import { relativeTime } from "~/lib/time";
import { MachineSheet } from "./MachineSheet";
import { ENGINE_DOING, jobLink, jobSubject, memoryView, servedHref, versioned } from "./activity";
import {
    type MachineFilters,
    type MachineRow,
    type Problem,
    ROLES,
    STATUSES,
    acceleratorOf,
    hardwareParts,
    machineRows,
    machineStatus,
    matches,
    problemsOf,
    statusOf,
} from "./machines";
import {
    type InfrastructureInfo,
    type NodeInfo,
    OnlineCount,
    type PoolInfo,
    RoomLine,
    plural,
} from "./parts";

const PATH = "/infrastructure/machines";
const KEYS = ["status", "pool", "role", "accelerator", "q", "machine"] as const;
const GROUPED_KEY = "minibrain.machines.grouped";
const INTERACTIVE = "a, button, input, [role=link]";
const COLUMN_COUNT = 7;

function readGrouped(): boolean {
    try {
        return window.localStorage.getItem(GROUPED_KEY) !== "false";
    } catch {
        return true;
    }
}

function writeGrouped(value: boolean) {
    try {
        window.localStorage.setItem(GROUPED_KEY, String(value));
    } catch {
        return;
    }
}

function useGrouped() {
    const [grouped, setGrouped] = useState(readGrouped);
    const save = (next: boolean) => {
        setGrouped(next);
        writeGrouped(next);
    };
    return [grouped, save] as const;
}

function seenText(row: MachineRow): string {
    if (row.node.online) {
        return "now";
    }
    return row.node.seen_at ? relativeTime(row.node.seen_at) : "never";
}

function ProblemBadge({ problems }: { problems: Problem[] }) {
    if (problems.length === 0) {
        return null;
    }
    const label = problems.map((problem) => problem.label).join(", ");
    const tone = problems.some((problem) => problem.tone === "destructive")
        ? "destructive"
        : "warning";
    return (
        <Tooltip>
            <TooltipTrigger asChild>
                <button type="button" aria-label={label} className="shrink-0 rounded-sm">
                    <Badge variant={tone} className="tabular-nums">
                        <TriangleAlert aria-hidden="true" />
                        {problems.length > 1 ? count(problems.length) : null}
                    </Badge>
                </button>
            </TooltipTrigger>
            <TooltipContent className="max-w-sm whitespace-normal">
                <ul className="flex flex-col gap-1">
                    {problems.map((problem) => (
                        <li key={problem.reason}>{problem.reason}</li>
                    ))}
                </ul>
            </TooltipContent>
        </Tooltip>
    );
}

type Activity = { key: string; content: ReactNode };

function activities(row: MachineRow): Activity[] {
    const engines = row.engines.map((engine) => {
        const verb = ENGINE_DOING[engine.state] ?? "Serving";
        const first = engine.serves[0];
        const more = engine.serves.length - 1;
        return {
            key: `engine-${engine.id}`,
            content: (
                <>
                    {`${verb} `}
                    {first ? (
                        <Link href={servedHref(first)} className="text-primary hover:underline">
                            {versioned(first.name, first.version)}
                        </Link>
                    ) : (
                        <span className="font-mono">{engine.base_model}</span>
                    )}
                    {more > 0 && (
                        <span className="text-muted-foreground">{` +${count(more)}`}</span>
                    )}
                </>
            ),
        };
    });
    const jobs = row.node.jobs.map((job) => ({
        key: `job-${job.id}`,
        content: (
            <>
                {`${kindNoun(job.kind)} `}
                <Link href={jobLink(job)} className="text-primary hover:underline">
                    {jobSubject(job)}
                </Link>
                <span className="text-muted-foreground tabular-nums">{` · ${Math.round(job.progress * 100)}%`}</span>
            </>
        ),
    }));
    return [...engines, ...jobs];
}

function RunningCell({ row }: { row: MachineRow }) {
    if (!row.node.online) {
        return <span className="text-muted-foreground">–</span>;
    }
    const doing = activities(row);
    if (doing.length === 0) {
        return <span className="text-muted-foreground">Idle</span>;
    }
    return (
        <span className="flex min-w-0 flex-col">
            {doing.map((item) => (
                <span key={item.key}>{item.content}</span>
            ))}
        </span>
    );
}

function shareText(used: number, total: number): string {
    return `${Math.round(Math.min(used / total, 9.99) * 100)}%`;
}

function HardwareCell({ node }: { node: NodeInfo }) {
    const { device, memory } = hardwareParts(node);
    return (
        <>
            {device}
            {memory && <span className="whitespace-nowrap">{` · ${memory}`}</span>}
        </>
    );
}

function MemoryCell({ row }: { row: MachineRow }) {
    const view = memoryView(row.node, row.engines);
    if (view === null) {
        return (
            <span className="text-muted-foreground">{row.node.online ? "Not reported" : "–"}</span>
        );
    }
    return (
        <span className="flex items-center gap-2">
            <UsageGauge
                segments={view.segments}
                capacity={view.capacity}
                label={`${row.node.host} memory`}
                legend={false}
                basis={view.basis}
                size="sm"
                className="w-14 shrink-0"
            />
            <span className="text-sm whitespace-nowrap text-muted-foreground tabular-nums">
                {`${shareText(view.used, view.capacity)} ${BASIS_LABELS[view.basis].toLowerCase()}`}
            </span>
        </span>
    );
}

function GroupRow({ pool }: { pool: PoolInfo }) {
    return (
        <TableRow
            id={`pool-${pool.name}`}
            className="scroll-mt-24 bg-muted transition-colors duration-150 hover:bg-muted data-flash:bg-highlight motion-reduce:transition-none"
        >
            <TableCell colSpan={COLUMN_COUNT} className="py-1.5">
                <span className="flex flex-wrap items-baseline gap-x-3 text-sm">
                    <span className="font-medium text-foreground">{pool.name}</span>
                    {pool.label !== pool.name && (
                        <span className="text-muted-foreground">{pool.label}</span>
                    )}
                    <OnlineCount nodes={pool.nodes} />
                    <span className="text-muted-foreground tabular-nums">
                        {plural(pool.engines.length, "engine")}
                    </span>
                    <RoomLine room={pool.room} />
                </span>
            </TableCell>
        </TableRow>
    );
}

function MachineLine({
    row,
    grouped,
    problems,
    anchor,
    onOpen,
}: {
    row: MachineRow;
    grouped: boolean;
    problems: Problem[];
    anchor?: string;
    onOpen: (row: MachineRow) => void;
}) {
    const { node } = row;
    const status = machineStatus(node, row.engines);
    const click = (event: MouseEvent<HTMLTableRowElement>) => {
        if ((event.target as HTMLElement).closest(INTERACTIVE)) {
            return;
        }
        onOpen(row);
    };
    const key = (event: KeyboardEvent<HTMLTableRowElement>) => {
        if (event.target !== event.currentTarget) {
            return;
        }
        if (event.key === "Enter") {
            event.preventDefault();
            onOpen(row);
        }
    };
    return (
        <TableRow
            id={anchor}
            tabIndex={0}
            aria-label={`${node.host}, ${status.label.toLowerCase()}`}
            onClick={click}
            onKeyDown={key}
            className={cn(
                "cursor-pointer scroll-mt-24 outline-none focus-visible:bg-secondary",
                !node.online && "text-muted-foreground",
            )}
        >
            <TableCell className="py-2">
                <StatusText tone={status.tone} active={status.active}>
                    {status.label}
                </StatusText>
            </TableCell>
            <TableCell className="py-2">
                <span className="flex min-w-0 items-center gap-2">
                    <span className="flex min-w-0 flex-col">
                        <span className="truncate font-mono text-foreground">{node.host}</span>
                        {!grouped && (
                            <span className="text-sm text-muted-foreground">
                                <PoolLink name={row.pool.name} />
                            </span>
                        )}
                    </span>
                    <ProblemBadge problems={problems} />
                </span>
            </TableCell>
            <TableCell className="py-2">{node.roles.join(", ")}</TableCell>
            <TableCell className="max-w-56 py-2 whitespace-normal">
                <HardwareCell node={node} />
            </TableCell>
            <TableCell className="py-2">
                <MemoryCell row={row} />
            </TableCell>
            <TableCell className="min-w-44 py-2 whitespace-normal">
                <RunningCell row={row} />
            </TableCell>
            <TableCell className="py-2">{seenText(row)}</TableCell>
        </TableRow>
    );
}

function options(values: string[]): { value: string; label: string }[] {
    return [...new Set(values)].sort().map((value) => ({ value, label: value }));
}

function filterSections(
    rows: MachineRow[],
    filters: MachineFilters,
    update: (patch: Partial<Record<(typeof KEYS)[number], string>>) => void,
): FilterMenuSection[] {
    const counted = (
        items: { value: string; label: string }[],
        test: (row: MachineRow, value: string) => boolean,
    ) =>
        items.map((item) => ({
            ...item,
            count: rows.filter((row) => test(row, item.value)).length,
        }));
    return [
        {
            kind: "options",
            key: "status",
            title: "Status",
            options: counted(STATUSES, (row, value) => statusOf(row.node) === value),
            value: filters.status,
            onValueChange: (next) => update({ status: next.join(",") }),
        },
        {
            kind: "options",
            key: "pool",
            title: "Pool",
            options: counted(
                [...new Set(rows.map((row) => row.pool.name))].map((value) => ({
                    value,
                    label: value,
                })),
                (row, value) => row.pool.name === value,
            ),
            value: filters.pool,
            onValueChange: (next) => update({ pool: next.join(",") }),
        },
        {
            kind: "options",
            key: "role",
            title: "Role",
            options: counted(ROLES, (row, value) => row.node.roles.includes(value)).filter(
                (item) => item.count > 0 || filters.role.includes(item.value),
            ),
            value: filters.role,
            onValueChange: (next) => update({ role: next.join(",") }),
        },
        {
            kind: "options",
            key: "accelerator",
            title: "Accelerator",
            options: counted(
                options(rows.map((row) => acceleratorOf(row.node))),
                (row, value) => acceleratorOf(row.node) === value,
            ),
            value: filters.accelerator,
            onValueChange: (next) => update({ accelerator: next.join(",") }),
        },
    ];
}

export function MachinesTab({
    pools,
    main,
    info,
    loading,
}: {
    pools: PoolInfo[];
    main: Record<string, string>;
    info: InfrastructureInfo | undefined;
    loading: boolean;
}) {
    const { search, update } = useListSearch(PATH, KEYS);
    const [grouped, setGrouped] = useGrouped();
    useScrollToHash(!loading);
    const filters: MachineFilters = {
        status: splitList(search.status),
        pool: splitList(search.pool),
        role: splitList(search.role),
        accelerator: splitList(search.accelerator),
        q: search.q ?? "",
    };
    const all = machineRows(pools);
    const shown = all.filter((row) => matches(row, filters));
    const filtering =
        filters.status.length +
            filters.pool.length +
            filters.role.length +
            filters.accelerator.length >
            0 || filters.q !== "";
    const clear = () => update({ status: "", pool: "", role: "", accelerator: "", q: "" });
    const selected = all.find((row) => row.node.id === search.machine) ?? null;
    const openRow = (row: MachineRow) => update({ machine: row.node.id });
    const firstOfPool = new Set(
        pools.map((pool) => shown.find((row) => row.pool.name === pool.name)?.node.id),
    );
    const line = (row: MachineRow) => (
        <MachineLine
            key={row.node.id}
            row={row}
            grouped={grouped}
            problems={problemsOf(row, main, info)}
            anchor={!grouped && firstOfPool.has(row.node.id) ? `pool-${row.pool.name}` : undefined}
            onOpen={openRow}
        />
    );
    const body = grouped
        ? pools.flatMap((pool) => {
              const rows = shown.filter((row) => row.pool.name === pool.name);
              if (rows.length === 0) {
                  return [];
              }
              return [<GroupRow key={`group-${pool.name}`} pool={pool} />, ...rows.map(line)];
          })
        : shown.map(line);
    return (
        <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
                <SearchInput
                    aria-label="Search machines"
                    placeholder="Search by machine name"
                    value={search.q ?? ""}
                    onValueChange={(q) => update({ q })}
                    className="w-full min-w-48 max-w-xs flex-1"
                />
                <FilterMenu
                    align="start"
                    sections={filterSections(all, filters, update)}
                    onClear={clear}
                    summary={`${count(shown.length)} of ${plural(all.length, "machine")}`}
                />
                {filtering && (
                    <Button variant="ghost" onClick={clear}>
                        Clear filters
                    </Button>
                )}
                <Label className="ml-auto flex items-center gap-2 font-normal">
                    <Switch
                        checked={grouped}
                        onCheckedChange={(next) => setGrouped(next === true)}
                    />
                    Group by pool
                </Label>
            </div>
            <div className="overflow-hidden rounded-md border bg-card">
                <Table className="min-w-[880px]">
                    <TableHeader>
                        <TableRow className="hover:bg-transparent">
                            <TableHead>Status</TableHead>
                            <TableHead>Machine</TableHead>
                            <TableHead>Role</TableHead>
                            <TableHead>Hardware</TableHead>
                            <TableHead>Memory</TableHead>
                            <TableHead>Running</TableHead>
                            <TableHead>Seen</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {body.length > 0 ? (
                            body
                        ) : (
                            <TableRow className="hover:bg-transparent">
                                <TableCell
                                    colSpan={COLUMN_COUNT}
                                    className="h-32 text-center text-muted-foreground"
                                >
                                    {loading ? (
                                        "Loading machines…"
                                    ) : filtering ? (
                                        <span className="inline-flex items-center gap-2">
                                            No machines match these filters.
                                            <Button variant="outline" onClick={clear}>
                                                Clear filters
                                            </Button>
                                        </span>
                                    ) : (
                                        "No machines yet."
                                    )}
                                </TableCell>
                            </TableRow>
                        )}
                    </TableBody>
                </Table>
            </div>
            <MachineSheet
                row={selected}
                main={main}
                info={info}
                problems={selected ? problemsOf(selected, main, info) : []}
                onClose={() => update({ machine: "" })}
            />
        </div>
    );
}
