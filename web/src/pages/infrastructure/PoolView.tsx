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
import { engineLabel, jobLink, jobSubject, servedHref, versioned, worstState } from "./activity";
import { servedOn } from "./byModel";
import {
    Dash,
    JobProgressChip,
    Lead,
    MachineLabel,
    MemoryFigure,
    ModelChip,
    SortHead,
} from "./cells";
import {
    cpuOf,
    gpuText,
    jobChips,
    memoryOf,
    modelChips,
    percentText,
    poolMemory,
    poolProblems,
    ramOf,
    shareOf,
} from "./fleet";
import type { MachineRow } from "./machines";
import {
    OnlineCount,
    type OpenRows,
    type PoolInfo,
    ProblemBadge,
    RowToggle,
    plural,
    rowEvents,
} from "./parts";
import { type Sort, type SortKey, nextSort, sortRows } from "./sorting";

const COLUMNS: { key: SortKey; label: string; width: string; numeric?: boolean }[] = [
    { key: "host", label: "Machine", width: "w-[18rem]" },
    { key: "gpu", label: "GPU", width: "w-[7.5rem]" },
    { key: "memory", label: "GPU memory", width: "w-[8.5rem]" },
    { key: "cpu", label: "CPU", width: "w-[5.5rem]", numeric: true },
    { key: "ram", label: "RAM", width: "w-[5.5rem]", numeric: true },
    { key: "models", label: "Models", width: "" },
    { key: "jobs", label: "Jobs", width: "w-[7.5rem]" },
];

const SPAN = COLUMNS.length;
const TRAILING = 4;
const DETAIL = SPAN - 1;
const MAX_CHIPS = 5;
const NAMED = ["@[13rem]:flex", "@[24rem]:flex"];
const COMPACT = ["@[13rem]:hidden", "@[24rem]:hidden"];
const LINK = "text-primary hover:underline";
const ROW = "h-12";
const CELL = "py-1.5";
const NUMBER = "py-1.5 text-right tabular-nums";
const LEADING = "flex min-w-0 items-center gap-2";

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
    const memory = poolMemory(rows);
    return (
        <TableRow
            id={`pool-${pool.name}`}
            className={cn(
                ROW,
                "scroll-mt-24 bg-muted transition-colors duration-150 hover:bg-muted data-flash:bg-highlight motion-reduce:transition-none",
            )}
        >
            <TableCell className={CELL}>
                <span className={LEADING}>
                    <RowToggle
                        open={open}
                        label={`${open ? "Hide" : "Show"} machines of ${pool.name}`}
                        onToggle={() => onToggle(!open)}
                    />
                    <Lead>
                        <IconStack2 aria-hidden="true" className="size-4 text-muted-foreground" />
                    </Lead>
                    <span
                        className="shrink-0 font-medium"
                        title={pool.label !== pool.name ? pool.label : undefined}
                    >
                        {pool.name}
                    </span>
                    <UseBadge workloads={pool.workloads} />
                    <ProblemBadge problems={problems} />
                    <span className="min-w-0 truncate text-sm">
                        <OnlineCount nodes={pool.nodes} />
                    </span>
                </span>
            </TableCell>
            <TableCell className={CELL} />
            <TableCell className={CELL}>
                {memory && (
                    <MemoryFigure
                        used={memory.used}
                        capacity={memory.capacity}
                        basis={memory.basis}
                        host={pool.name}
                    />
                )}
            </TableCell>
            <TableCell colSpan={TRAILING} className={CELL}>
                {admin && (
                    <span className="flex items-center justify-end gap-2">
                        {pool.name !== LOCAL_POOL && (
                            <PoolJoinControls pool={pool.name} token={token} />
                        )}
                        <PoolMenu pool={pool.name} workloads={pool.workloads} />
                    </span>
                )}
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
        return <Dash />;
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
    const memory = memoryOf(row);
    const cpu = cpuOf(node);
    const ram = ramOf(node);
    const expandable = hasActivity(row);
    return (
        <TableRow
            {...rowEvents(() => onOpen(row), expandable ? onToggle : undefined)}
            aria-label={node.host}
            className={cn(
                ROW,
                "cursor-pointer outline-none focus-visible:bg-secondary",
                !node.online && "text-muted-foreground",
            )}
        >
            <TableCell className={CELL}>
                <span className={LEADING}>
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
            <TableCell className={CELL}>
                <span className="block truncate" title={gpuText(node)}>
                    {gpuText(node, true)}
                </span>
            </TableCell>
            <TableCell className={CELL}>
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
            <TableCell className={NUMBER}>
                {cpu === null ? <Dash /> : `${Math.round(cpu)}%`}
            </TableCell>
            <TableCell className={NUMBER}>
                {ram.used !== null && ram.total ? (
                    <span title={`${bytes(ram.used)} of ${bytes(ram.total)} RAM in use`}>
                        {percentText(shareOf(ram.used, ram.total))}
                    </span>
                ) : (
                    <Dash />
                )}
            </TableCell>
            <TableCell className={CELL}>
                <ModelsCell row={row} />
            </TableCell>
            <TableCell className={CELL}>
                <JobsCell row={row} />
            </TableCell>
        </TableRow>
    );
}

function SubRow({
    lead,
    name,
    detail,
}: {
    lead: ReactNode;
    name: ReactNode;
    detail: ReactNode;
}) {
    return (
        <TableRow className={cn(ROW, "border-border-soft hover:bg-transparent")}>
            <TableCell className={CELL}>
                <span className={LEADING}>
                    <span className="w-6 shrink-0" />
                    <Lead>{lead}</Lead>
                    <span className="min-w-0 truncate">{name}</span>
                </span>
            </TableCell>
            <TableCell colSpan={DETAIL} className={CELL}>
                <span className="flex min-w-0 items-center gap-2 text-muted-foreground">
                    {detail}
                </span>
            </TableCell>
        </TableRow>
    );
}

function engineDetail(replicas: number, engine: string): string {
    const label = engineLabel(engine);
    return replicas > 1 ? `${plural(replicas, "replica")} · ${label}` : label;
}

function ActivityRows({ row }: { row: MachineRow }) {
    const { models, bare } = servedOn(row.engines);
    return (
        <>
            {models.map(({ served, engines }) => {
                const state = worstState(engines);
                return (
                    <SubRow
                        key={`served-${served.model}`}
                        lead={
                            <PublisherLogo name={served.name} modelKey={served.model} size="sm" />
                        }
                        name={
                            <Link href={servedHref(served)} className={LINK}>
                                {versioned(served.name, served.version)}
                            </Link>
                        }
                        detail={
                            <>
                                <StatusText tone={state.tone} active={state.active}>
                                    {state.label}
                                </StatusText>
                                <span className="truncate">
                                    {engineDetail(engines.length, engines[0].engine)}
                                </span>
                            </>
                        }
                    />
                );
            })}
            {bare.map((engine) => {
                const state = worstState([engine]);
                return (
                    <SubRow
                        key={`engine-${engine.id}`}
                        lead={
                            <PublisherLogo
                                name={engine.base_model}
                                modelKey={engine.base_model}
                                size="sm"
                            />
                        }
                        name={<span className="font-mono">{engine.base_model}</span>}
                        detail={
                            <>
                                <StatusText tone={state.tone} active={state.active}>
                                    {state.label}
                                </StatusText>
                                <span className="truncate">
                                    {`No model deployed · ${engineLabel(engine.engine)}`}
                                </span>
                            </>
                        }
                    />
                );
            })}
            {row.node.jobs.map((job) => (
                <SubRow
                    key={`job-${job.id}`}
                    lead={null}
                    name={
                        <Link href={jobLink(job)} className={LINK}>
                            {jobSubject(job)}
                        </Link>
                    }
                    detail={
                        <>
                            <StatusText
                                tone="info"
                                active
                                progress={job.progress > 0 ? percentOf(job.progress) : null}
                            >
                                {kindNoun(job.kind)}
                            </StatusText>
                            <span className="truncate tabular-nums">
                                {`${Math.round(job.progress * 100)}% · `}
                                <Link href={jobHref(job)} className={LINK}>
                                    {`Job ${job.id}`}
                                </Link>
                            </span>
                        </>
                    }
                />
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
