import { IconStack2 } from "@tabler/icons-react";
import { Link, Table, TableBody, TableCell, TableHeader, TableRow, cn } from "obp-ui";
import { Fragment, type ReactNode, useState } from "react";
import type { PoolToken } from "~/api/joinTokenQueries";
import { type Problem, problemsOfMachine } from "~/api/problemQueries";
import { PublisherLogo } from "~/components/PublisherLogo";
import { StatusText, percentOf } from "~/components/models/StatusText";
import { count } from "~/lib/format";
import { kindNoun } from "~/lib/jobs";
import { jobHref } from "~/lib/modelLinks";
import { bytes } from "~/lib/time";
import { LOCAL_POOL, PoolJoinControls } from "./PoolJoin";
import { PoolMenu, UseBadge } from "./PoolUse";
import {
    type NodeJob,
    engineLabel,
    jobLink,
    jobSubject,
    servedHref,
    versioned,
    worstState,
} from "./activity";
import { servedOn } from "./byModel";
import {
    Dash,
    JobProgressChip,
    MachineLabel,
    MemoryFigure,
    MeterBar,
    ModelChip,
    SortHead,
    Tip,
} from "./cells";
import {
    cpuOf,
    gpuText,
    jobChips,
    memoryOf,
    memoryText,
    modelChips,
    percentText,
    poolProblems,
    poolTotals,
    ramOf,
    shareOf,
    statusTone,
} from "./fleet";
import type { MachineRow } from "./machines";
import {
    OnlineCount,
    type OpenRows,
    type PoolInfo,
    ProblemBadge,
    RowToggle,
    plural,
    roomText,
    rowEvents,
} from "./parts";
import { type Sort, type SortKey, nextSort, sortRows } from "./sorting";

const COLUMNS: { key: SortKey; label: string; width: string; numeric?: boolean }[] = [
    { key: "host", label: "Machine", width: "w-[20rem]" },
    { key: "gpu", label: "GPU", width: "w-[7.5rem]" },
    { key: "memory", label: "GPU memory", width: "w-[8.5rem]" },
    { key: "cpu", label: "CPU", width: "w-[4.5rem]", numeric: true },
    { key: "ram", label: "RAM", width: "w-[4.5rem]", numeric: true },
    { key: "models", label: "Models", width: "" },
    { key: "jobs", label: "Jobs", width: "w-[8.5rem]" },
];

const SPAN = COLUMNS.length;
const MAX_CHIPS = 5;
const NAMED = ["@[13rem]:flex", "@[24rem]:flex"];
const COMPACT = ["@[13rem]:hidden", "@[24rem]:hidden"];
const LINK = "text-primary hover:underline";
const SUB_GRID = "grid grid-cols-[9rem_minmax(0,18rem)_minmax(0,1fr)] items-center gap-x-4";

function Stat({
    label,
    children,
    className,
}: {
    label: string;
    children: ReactNode;
    className?: string;
}) {
    return (
        <span className={cn("flex shrink-0 items-center gap-1.5 tabular-nums", className)}>
            <span className="text-muted-foreground">{label}</span>
            {children}
        </span>
    );
}

function PoolBand({
    pool,
    rows,
    problems,
    admin,
    token,
    open,
    onToggle,
}: {
    pool: PoolInfo;
    rows: MachineRow[];
    problems: Problem[];
    admin: boolean;
    token: PoolToken | undefined;
    open: boolean;
    onToggle: (open: boolean) => void;
}) {
    const totals = poolTotals(pool, rows);
    return (
        <TableRow
            id={`pool-${pool.name}`}
            className="h-14 scroll-mt-24 bg-muted transition-colors duration-150 hover:bg-muted data-flash:bg-highlight motion-reduce:transition-none"
        >
            <TableCell colSpan={SPAN} className="py-1.5 pl-1.5">
                <span className="@container flex min-w-0 items-center gap-x-5 text-sm">
                    <span className="flex shrink-0 items-center gap-2 text-base">
                        <RowToggle
                            open={open}
                            label={`${open ? "Hide" : "Show"} machines of ${pool.name}`}
                            onToggle={() => onToggle(!open)}
                        />
                        <IconStack2
                            aria-hidden="true"
                            className="size-4 shrink-0 text-muted-foreground"
                        />
                        <span className="font-medium">{pool.name}</span>
                        {pool.label !== pool.name && (
                            <span className="text-sm text-muted-foreground">{pool.label}</span>
                        )}
                        <UseBadge workloads={pool.workloads} />
                        <ProblemBadge problems={problems} />
                    </span>
                    <OnlineCount nodes={pool.nodes} />
                    {rows.length < pool.nodes.length && (
                        <span className="shrink-0 text-muted-foreground tabular-nums">
                            {`${count(rows.length)} shown`}
                        </span>
                    )}
                    {totals.machines > 0 && (
                        <Stat label="GPUs" className="hidden min-w-0 shrink @[64rem]:flex">
                            <span className="truncate" title={totals.gpus}>
                                {totals.gpus}
                            </span>
                        </Stat>
                    )}
                    {totals.capacity > 0 && (
                        <Stat label="Memory">
                            <Tip
                                tip={`${memoryText(totals.used, totals.capacity)} in use across the online machines`}
                            >
                                <span className="flex cursor-default items-center gap-2">
                                    <MeterBar
                                        used={totals.used}
                                        capacity={totals.capacity}
                                        label={`${pool.name} memory`}
                                        className="w-16 shrink-0"
                                    />
                                    {percentText(shareOf(totals.used, totals.capacity))}
                                </span>
                            </Tip>
                        </Stat>
                    )}
                    <Stat label="Engines">{count(totals.engines)}</Stat>
                    <Stat label="Jobs">{count(totals.jobs)}</Stat>
                    {pool.room && (
                        <Tip tip={pool.room.basis}>
                            <span className="hidden min-w-0 cursor-default truncate text-muted-foreground @[80rem]:block">
                                {roomText(pool.room)}
                            </span>
                        </Tip>
                    )}
                    {admin && (
                        <span className="ml-auto flex shrink-0 items-center gap-2">
                            {pool.name !== LOCAL_POOL && (
                                <PoolJoinControls pool={pool.name} token={token} />
                            )}
                            <PoolMenu pool={pool.name} workloads={pool.workloads} />
                        </span>
                    )}
                </span>
            </TableCell>
        </TableRow>
    );
}

function ModelsCell({ row }: { row: MachineRow }) {
    if (!row.node.online) {
        return <Dash />;
    }
    const chips = modelChips(row);
    if (chips.length === 0) {
        return <span className="text-muted-foreground">None</span>;
    }
    const shown = chips.slice(0, MAX_CHIPS);
    return (
        <div className="@container w-full">
            <span className="flex min-w-0 items-center gap-1">
                {shown.map((chip, index) => (
                    <Fragment key={chip.key}>
                        {index < NAMED.length && (
                            <span className={cn("hidden min-w-0", NAMED[index])}>
                                <ModelChip chip={chip} />
                            </span>
                        )}
                        <span className={cn("flex shrink-0", COMPACT[index])}>
                            <ModelChip chip={chip} compact />
                        </span>
                    </Fragment>
                ))}
                {chips.length > shown.length && (
                    <span className="shrink-0 text-sm text-muted-foreground tabular-nums">{`+${count(chips.length - shown.length)}`}</span>
                )}
            </span>
        </div>
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

function hasActivity(row: MachineRow): boolean {
    return row.engines.length > 0 || row.node.jobs.length > 0;
}

function MachineLine({
    row,
    problems,
    open,
    onToggle,
    onOpen,
}: {
    row: MachineRow;
    problems: Problem[];
    open: boolean;
    onToggle: (open: boolean) => void;
    onOpen: (row: MachineRow) => void;
}) {
    const { node } = row;
    const status = statusTone(row);
    const memory = memoryOf(row);
    const cpu = cpuOf(node);
    const ram = ramOf(node);
    const expandable = hasActivity(row);
    return (
        <TableRow
            {...rowEvents(() => onOpen(row), expandable ? onToggle : undefined)}
            aria-label={`${node.host}, ${status.label.toLowerCase()}`}
            className={cn(
                "h-14 cursor-pointer outline-none focus-visible:bg-secondary",
                !node.online && "text-muted-foreground",
            )}
        >
            <TableCell className="py-1 pl-1.5">
                <span className="flex min-w-0 items-center gap-1.5 pl-6">
                    <span className="flex w-6 shrink-0">
                        {expandable && (
                            <RowToggle
                                open={open}
                                label={`${open ? "Hide" : "Show"} what runs on ${node.host}`}
                                onToggle={() => onToggle(!open)}
                            />
                        )}
                    </span>
                    <MachineLabel row={row} problems={problems} />
                </span>
            </TableCell>
            <TableCell className="py-1">
                <span className="block truncate" title={gpuText(node)}>
                    {gpuText(node, true)}
                </span>
            </TableCell>
            <TableCell className="py-1">
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
            <TableCell className="py-1 text-right tabular-nums">
                {cpu === null ? <Dash /> : `${Math.round(cpu)}%`}
            </TableCell>
            <TableCell className="py-1 text-right tabular-nums">
                {ram.used !== null && ram.total ? (
                    <Tip tip={`${bytes(ram.used)} of ${bytes(ram.total)} RAM in use`}>
                        <span className="cursor-default">
                            {percentText(shareOf(ram.used, ram.total))}
                        </span>
                    </Tip>
                ) : (
                    <Dash />
                )}
            </TableCell>
            <TableCell className="py-1">
                <ModelsCell row={row} />
            </TableCell>
            <TableCell className="py-1">
                <JobsCell row={row} />
            </TableCell>
        </TableRow>
    );
}

function SubRow({ children }: { children: ReactNode }) {
    return (
        <TableRow className="h-10 border-border-soft hover:bg-transparent">
            <TableCell colSpan={SPAN} className="py-1.5 pl-[5.25rem]">
                <span className={SUB_GRID}>{children}</span>
            </TableCell>
        </TableRow>
    );
}

function JobDetail({ job }: { job: NodeJob }) {
    return (
        <span className="truncate text-sm text-muted-foreground tabular-nums">
            {`${Math.round(job.progress * 100)}% · `}
            <Link href={jobHref(job)} className={LINK}>
                {`Job ${job.id}`}
            </Link>
        </span>
    );
}

function ActivityRows({ row }: { row: MachineRow }) {
    const { models, bare } = servedOn(row.engines);
    return (
        <>
            {models.map(({ served, engines }) => {
                const state = worstState(engines);
                return (
                    <SubRow key={`served-${served.model}`}>
                        <StatusText tone={state.tone} active={state.active}>
                            {state.label}
                        </StatusText>
                        <span className="flex min-w-0 items-center gap-2">
                            <PublisherLogo name={served.name} modelKey={served.model} size="sm" />
                            <Link href={servedHref(served)} className={cn(LINK, "truncate")}>
                                {versioned(served.name, served.version)}
                            </Link>
                        </span>
                        <span className="truncate text-sm text-muted-foreground tabular-nums">
                            {`${plural(engines.length, "replica")} here · ${engineLabel(engines[0].engine)}`}
                        </span>
                    </SubRow>
                );
            })}
            {bare.map((engine) => {
                const state = worstState([engine]);
                return (
                    <SubRow key={`engine-${engine.id}`}>
                        <StatusText tone={state.tone} active={state.active}>
                            {state.label}
                        </StatusText>
                        <span className="flex min-w-0 items-center gap-2">
                            <PublisherLogo
                                name={engine.base_model}
                                modelKey={engine.base_model}
                                size="sm"
                            />
                            <span className="truncate font-mono">{engine.base_model}</span>
                        </span>
                        <span className="truncate text-sm text-muted-foreground">
                            {`No model deployed · ${engineLabel(engine.engine)}`}
                        </span>
                    </SubRow>
                );
            })}
            {row.node.jobs.map((job) => (
                <SubRow key={`job-${job.id}`}>
                    <StatusText
                        tone="info"
                        active
                        progress={job.progress > 0 ? percentOf(job.progress) : null}
                    >
                        {kindNoun(job.kind)}
                    </StatusText>
                    <span className="truncate">
                        <Link href={jobLink(job)} className={LINK}>
                            {jobSubject(job)}
                        </Link>
                    </span>
                    <JobDetail job={job} />
                </SubRow>
            ))}
        </>
    );
}

function bodyRows({
    pools,
    shown,
    problems,
    admin,
    tokens,
    sort,
    open,
    onOpen,
}: {
    pools: PoolInfo[];
    shown: MachineRow[];
    problems: Problem[] | undefined;
    admin: boolean;
    tokens: PoolToken[] | undefined;
    sort: Sort | null;
    open: OpenRows;
    onOpen: (row: MachineRow) => void;
}): ReactNode[] {
    return pools.flatMap((pool) => {
        const rows = shown.filter((row) => row.pool.name === pool.name);
        if (rows.length === 0) {
            return [];
        }
        const poolKey = `pool:${pool.name}`;
        const poolOpen = open.isOpen(poolKey, true);
        const band = (
            <PoolBand
                key={poolKey}
                pool={pool}
                rows={rows}
                problems={poolProblems(problems, pool.name)}
                admin={admin}
                token={tokens?.find((token) => token.pool === pool.name)}
                open={poolOpen}
                onToggle={(next) => open.set(poolKey, next)}
            />
        );
        if (!poolOpen) {
            return [band];
        }
        return [
            band,
            ...sortRows(rows, sort).flatMap((row) => {
                const key = `machine:${row.node.id}`;
                const expanded = hasActivity(row) && open.isOpen(key, false);
                return [
                    <MachineLine
                        key={key}
                        row={row}
                        problems={problemsOfMachine(problems, row.node.id)}
                        open={expanded}
                        onToggle={(next) => open.set(key, next)}
                        onOpen={onOpen}
                    />,
                    expanded ? <ActivityRows key={`${key}:activity`} row={row} /> : null,
                ];
            }),
        ];
    });
}

export function PoolTable({
    pools,
    shown,
    problems,
    admin,
    tokens,
    open,
    empty,
    onOpen,
}: {
    pools: PoolInfo[];
    shown: MachineRow[];
    problems: Problem[] | undefined;
    admin: boolean;
    tokens: PoolToken[] | undefined;
    open: OpenRows;
    empty: ReactNode;
    onOpen: (row: MachineRow) => void;
}) {
    const [sort, setSort] = useState<Sort | null>(null);
    const body = bodyRows({ pools, shown, problems, admin, tokens, sort, open, onOpen });
    return (
        <Table className="table-fixed [&_td]:overflow-hidden">
            <colgroup>
                {COLUMNS.map((column) => (
                    <col key={column.key} className={column.width} />
                ))}
            </colgroup>
            <TableHeader>
                <TableRow className="hover:bg-transparent">
                    {COLUMNS.map((column) => (
                        <SortHead
                            key={column.key}
                            label={column.label}
                            sortKey={column.key}
                            numeric={column.numeric}
                            sort={sort}
                            onSort={(key) => setSort((current) => nextSort(current, key))}
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
