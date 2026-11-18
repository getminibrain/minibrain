import { IconStack2 } from "@tabler/icons-react";
import {
    type ColumnSize,
    type ColumnSizing,
    FilterMenu,
    type FilterMenuSection,
    Label,
    Switch,
    Table,
    TableBody,
    TableCell,
    TableHeader,
    TableRow,
    cn,
    useColumnSizing,
} from "obp-ui";
import { Fragment, type ReactNode } from "react";
import { type Problem, problemsOfMachine } from "~/api/problemQueries";
import { PoolLink } from "~/components/PoolLink";
import { StatusText } from "~/components/models/StatusText";
import { count } from "~/lib/format";
import { type ListSearch, splitList } from "~/lib/listSearch";
import { exactTime } from "~/lib/time";
import { UseBadge, useOf } from "../PoolUse";
import { Dash, JobProgressChip, MemoryFigure, ModelsCell, SortHead, Tip } from "../cells";
import {
    agoText,
    gpuText,
    jobChips,
    memoryOf,
    memoryText,
    poolMemory,
    problemLabel,
    problemTone,
    statusTone,
} from "../fleet";
import type { MachineRow } from "../machines";
import { OnlineCount, type PoolInfo, plural, rowEvents } from "../parts";
import { type SortKey, sortRows } from "../sorting";
import {
    type FilteredMachines,
    MachineToolbar,
    type MachinesView,
    ViewMenu,
    WIDTHS_KEY,
    emptyText,
    fitKeyOf,
} from "./shared";
import type { MachineKey } from "./switcher";

const COLUMNS: (ColumnSize & { id: SortKey; label: string; numeric?: boolean })[] = [
    { id: "host", label: "Machine", width: 160, min: 120 },
    { id: "pool", label: "Pool", width: 96, min: 72 },
    { id: "status", label: "Status", width: 112, min: 88 },
    { id: "gpu", label: "GPU", width: 88, min: 64 },
    { id: "memory", label: "GPU memory", width: 128, min: 104 },
    { id: "models", label: "Models", width: 240, min: 200, flex: true },
    { id: "jobs", label: "Jobs", width: 120, min: 104 },
];

const SPAN = COLUMNS.length;
const ROW = "h-10";
const CELL = "py-1";
const GROUPED = "pool";

const USES = [
    { value: "any", label: "Any" },
    { value: "serving", label: "Serving" },
    { value: "training", label: "Training" },
];

const STATES = [
    { value: "problems", label: "Has problems" },
    { value: "online", label: "Online" },
    { value: "offline", label: "Offline" },
    { value: "draining", label: "Draining" },
];

function shownProblems(problems: Problem[] | undefined, row: MachineRow): Problem[] {
    return problemsOfMachine(problems, row.node.id).filter(
        (problem) => problem.kind !== "machine_offline",
    );
}

function stateMatches(row: MachineRow, state: string, problems: Problem[] | undefined): boolean {
    const tests: Record<string, () => boolean> = {
        problems: () => shownProblems(problems, row).length > 0,
        online: () => row.node.online && row.node.state !== "draining",
        offline: () => !row.node.online,
        draining: () => row.node.state === "draining",
    };
    return tests[state]?.() ?? false;
}

type FlatFilters = { pool: string[]; use: string[]; status: string[]; q: string };

function flatMatches(row: MachineRow, filters: FlatFilters, problems: Problem[] | undefined) {
    const text = filters.q.trim().toLowerCase();
    return (
        (filters.pool.length === 0 || filters.pool.includes(row.pool.name)) &&
        (filters.use.length === 0 || filters.use.includes(useOf(row.pool.workloads))) &&
        (filters.status.length === 0 ||
            filters.status.some((state) => stateMatches(row, state, problems))) &&
        (text === "" ||
            row.node.host.toLowerCase().includes(text) ||
            row.pool.name.toLowerCase().includes(text))
    );
}

function section(
    key: "pool" | "use" | "status",
    title: string,
    items: { value: string; label: string }[],
    value: string[],
    test: (row: MachineRow, value: string) => boolean,
    rows: MachineRow[],
    update: (patch: ListSearch<MachineKey>) => void,
): FilterMenuSection {
    return {
        kind: "options",
        key,
        title,
        options: items.map((item) => ({
            ...item,
            count: rows.filter((row) => test(row, item.value)).length,
        })),
        value,
        onValueChange: (next) => update({ [key]: next.join(",") }),
    };
}

function useFlatFilters(view: MachinesView) {
    const { search, update, all, problems } = view;
    const filters: FlatFilters = {
        pool: splitList(search.pool),
        use: splitList(search.use),
        status: splitList(search.status),
        q: search.q ?? "",
    };
    const filtering =
        filters.pool.length + filters.use.length + filters.status.length > 0 || filters.q !== "";
    const clear = () => update({ pool: "", use: "", status: "", q: "" });
    const pools = [...new Set(all.map((row) => row.pool.name))].map((name) => ({
        value: name,
        label: name,
    }));
    const menus = [
        section(
            "pool",
            "Pool",
            pools,
            filters.pool,
            (row, value) => row.pool.name === value,
            all,
            update,
        ),
        section(
            "use",
            "Use",
            USES,
            filters.use,
            (row, value) => useOf(row.pool.workloads) === value,
            all,
            update,
        ),
        section(
            "status",
            "Status",
            STATES,
            filters.status,
            (row, value) => stateMatches(row, value, problems),
            all,
            update,
        ),
    ];
    const shown = all.filter((row) => flatMatches(row, filters, problems));
    const filtered: FilteredMachines = {
        filters: { status: [], pool: [], role: [], accelerator: [], q: filters.q },
        shown,
        filtering,
        clear,
        sections: menus,
    };
    return {
        filtered,
        menus,
        summary: `${count(shown.length)} of ${plural(all.length, "machine")}`,
    };
}

function StatusCell({ row, problems }: { row: MachineRow; problems: Problem[] }) {
    if (problems.length > 0) {
        const [first] = problems;
        return (
            <Tip
                tip={
                    <ul className="flex flex-col gap-1">
                        {problems.map((problem) => (
                            <li key={problem.id}>{problem.text}</li>
                        ))}
                    </ul>
                }
            >
                <span className="flex min-w-0 cursor-default">
                    <StatusText tone={problemTone(problems)} className="min-w-0 max-w-full">
                        <span className="truncate">{problemLabel(first)}</span>
                        {problems.length > 1 && (
                            <span className="text-muted-foreground tabular-nums">{`+${count(problems.length - 1)}`}</span>
                        )}
                    </StatusText>
                </span>
            </Tip>
        );
    }
    const status = statusTone(row);
    const offline = !row.node.online && row.node.state !== "draining";
    return (
        <span
            className="flex min-w-0"
            title={offline && row.node.seen_at ? exactTime(row.node.seen_at) : undefined}
        >
            <StatusText tone={status.tone} active={status.active} className="min-w-0 max-w-full">
                <span className="truncate">
                    {offline ? `Offline ${agoText(row.node.seen_at)}` : status.label}
                </span>
            </StatusText>
        </span>
    );
}

function JobsCell({ row }: { row: MachineRow }) {
    const jobs = jobChips(row.node);
    if (jobs.length === 0) {
        return <Dash />;
    }
    return (
        <span className="flex min-w-0 items-center gap-1">
            <JobProgressChip chip={jobs[0]} />
            {jobs.length > 1 && (
                <span className="shrink-0 text-sm text-muted-foreground tabular-nums">{`+${count(jobs.length - 1)}`}</span>
            )}
        </span>
    );
}

function MachineLine({
    row,
    problems,
    onOpen,
}: {
    row: MachineRow;
    problems: Problem[];
    onOpen: (row: MachineRow) => void;
}) {
    const { node } = row;
    const memory = memoryOf(row);
    return (
        <TableRow
            {...rowEvents(() => onOpen(row))}
            aria-label={node.host}
            className={cn(
                ROW,
                "cursor-pointer outline-none focus-visible:bg-secondary",
                !node.online && "text-muted-foreground",
            )}
        >
            <TableCell data-column="host" className={CELL}>
                <span className={cn("block truncate font-mono", node.online && "text-foreground")}>
                    {node.host}
                </span>
            </TableCell>
            <TableCell data-column="pool" className={CELL}>
                <PoolLink name={row.pool.name} />
            </TableCell>
            <TableCell data-column="status" className={CELL}>
                <StatusCell row={row} problems={problems} />
            </TableCell>
            <TableCell data-column="gpu" className={CELL}>
                <span className="block truncate" title={gpuText(node)}>
                    {gpuText(node, true)}
                </span>
            </TableCell>
            <TableCell data-column="memory" className={CELL}>
                {memory ? (
                    <MemoryFigure
                        used={memory.used}
                        capacity={memory.capacity}
                        basis={memory.basis}
                        host={node.host}
                    />
                ) : (
                    <Dash />
                )}
            </TableCell>
            <TableCell className={CELL}>
                <ModelsCell row={row} />
            </TableCell>
            <TableCell data-column="jobs" className={CELL}>
                <JobsCell row={row} />
            </TableCell>
        </TableRow>
    );
}

function PoolHeading({ pool, rows }: { pool: PoolInfo; rows: MachineRow[] }) {
    const memory = poolMemory(rows);
    return (
        <TableRow
            id={`pool-${pool.name}`}
            className="h-8 scroll-mt-24 bg-muted transition-colors duration-150 hover:bg-muted data-flash:bg-highlight motion-reduce:transition-none"
        >
            <TableCell colSpan={SPAN} className="py-1">
                <span className="flex min-w-0 items-center gap-2">
                    <IconStack2
                        aria-hidden="true"
                        className="size-4 shrink-0 text-muted-foreground"
                    />
                    <span className="font-medium">{pool.name}</span>
                    <UseBadge workloads={pool.workloads} />
                    <span className="text-sm">
                        <OnlineCount nodes={pool.nodes} />
                    </span>
                    {memory && (
                        <span className="text-sm text-muted-foreground tabular-nums">
                            {`· ${memoryText(memory.used, memory.capacity)} GPU memory in use`}
                        </span>
                    )}
                </span>
            </TableCell>
        </TableRow>
    );
}

function FlatTable({
    view,
    rows,
    grouped,
    sizing,
    empty,
}: {
    view: MachinesView;
    rows: MachineRow[];
    grouped: boolean;
    sizing: ColumnSizing;
    empty: ReactNode;
}) {
    const sorted = sortRows(rows, view.sort, view.problems);
    const line = (row: MachineRow) => (
        <MachineLine
            key={row.node.id}
            row={row}
            problems={shownProblems(view.problems, row)}
            onOpen={view.onOpen}
        />
    );
    const body = grouped
        ? view.pools.flatMap((pool) => {
              const inPool = sorted.filter((row) => row.pool.name === pool.name);
              return inPool.length === 0
                  ? []
                  : [
                        <Fragment key={pool.name}>
                            <PoolHeading pool={pool} rows={inPool} />
                            {inPool.map(line)}
                        </Fragment>,
                    ];
          })
        : sorted.map(line);
    return (
        <Table ref={sizing.tableRef} style={sizing.tableStyle} className="[&_td]:overflow-hidden">
            <colgroup>
                {COLUMNS.map((column) => (
                    <col key={column.id} style={sizing.colStyle(column.id)} />
                ))}
            </colgroup>
            <TableHeader>
                <TableRow className="hover:bg-transparent">
                    {COLUMNS.map((column) => (
                        <SortHead
                            key={column.id}
                            label={column.label}
                            sortKey={column.id}
                            numeric={column.numeric}
                            sort={view.sort}
                            onSort={view.onSort}
                            sizing={sizing}
                        />
                    ))}
                </TableRow>
            </TableHeader>
            <TableBody>
                {body.length > 0 ? (
                    body
                ) : (
                    <TableRow className="hover:bg-transparent">
                        <TableCell
                            colSpan={SPAN}
                            className="h-32 text-center text-muted-foreground"
                        >
                            {empty}
                        </TableCell>
                    </TableRow>
                )}
            </TableBody>
        </Table>
    );
}

export function FlatLayout({ view }: { view: MachinesView }) {
    const { filtered, menus, summary } = useFlatFilters(view);
    const grouped = view.search.group === GROUPED;
    const sizing = useColumnSizing({
        columns: COLUMNS,
        storageKey: WIDTHS_KEY,
        fitKey: `${fitKeyOf(filtered.shown, view.problems)}|${grouped}`,
    });
    return (
        <>
            <MachineToolbar
                view={view}
                filtered={filtered}
                placeholder="Search by machine or pool"
                filters={menus.map((menu) => (
                    <FilterMenu
                        key={menu.key}
                        label={menu.title}
                        align="start"
                        sections={[menu]}
                        onClear={() => view.update({ [menu.key]: "" })}
                        summary={summary}
                    />
                ))}
                end={
                    <>
                        <Label className="flex h-8 items-center gap-2 font-normal">
                            <Switch
                                checked={grouped}
                                onCheckedChange={(next) =>
                                    view.update({ group: next === true ? GROUPED : "" })
                                }
                            />
                            Group by pool
                        </Label>
                        <ViewMenu sizing={sizing} />
                    </>
                }
            />
            <div className="overflow-hidden rounded-md border bg-card">
                <FlatTable
                    view={view}
                    rows={filtered.shown}
                    grouped={grouped}
                    sizing={sizing}
                    empty={emptyText(view, filtered)}
                />
            </div>
        </>
    );
}
