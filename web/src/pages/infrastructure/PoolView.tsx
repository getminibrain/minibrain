import { IconStack2 } from "@tabler/icons-react";
import {
    type ColumnSize,
    type ColumnSizing,
    Link,
    Table,
    TableBody,
    TableCell,
    TableHeader,
    TableRow,
    cn,
    useColumnSizing,
} from "obp-ui";
import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import type { PoolToken } from "~/api/joinTokenQueries";
import { type Problem, problemsOfMachine } from "~/api/problemQueries";
import { PoolLink } from "~/components/PoolLink";
import { PublisherLogo } from "~/components/PublisherLogo";
import { StatusText, percentOf } from "~/components/models/StatusText";
import { count } from "~/lib/format";
import { kindNoun } from "~/lib/jobs";
import { jobHref } from "~/lib/modelLinks";
import { bytes } from "~/lib/time";
import { PoolRowMenu } from "./PoolRowMenu";
import { PoolDescription, UseBadge } from "./PoolUse";
import { engineLabel, jobLink, jobSubject, servedHref, versioned, worstState } from "./activity";
import { servedOn } from "./byModel";
import {
    JobsCell,
    Lead,
    MemoryFigure,
    ModelChips,
    SortHead,
    StatusCell,
    Tip,
    UsagePercent,
} from "./cells";
import {
    cpuOf,
    gpuText,
    jobChips,
    machineStatuses,
    memoryOf,
    modelChips,
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
import { type Sort, type SortKey, sortRows } from "./sorting";

type Column = ColumnSize & { id: SortKey; label: string; numeric?: boolean };

const COLUMNS: Column[] = [
    { id: "host", label: "Machine", width: 144, min: 120 },
    { id: "status", label: "Status", width: 112, min: 96 },
    { id: "gpu", label: "GPU", width: 72, min: 64 },
    { id: "memory", label: "GPU memory", width: 112, min: 104 },
    { id: "cpu", label: "CPU", width: 56, min: 56, numeric: true },
    { id: "ram", label: "RAM", width: 56, min: 56, numeric: true },
    { id: "models", label: "Models", width: 136, min: 136, flex: true },
    { id: "jobs", label: "Jobs", width: 144, min: 128 },
];

const MODELS_MIN = 136;
const MODELS_MAX = 400;
const MODELS_SHARE = 0.22;
const SHARE_FROM = 1100;

const SPAN = COLUMNS.length;
const POOL_LEAD = 3;
const LINK = "text-primary hover:underline";
const ROW = "h-10";
const CELL = "py-1";
const NUMBER = "py-1 text-right tabular-nums";
const LEADING = "flex min-w-0 items-center gap-2";
const WIDTHS_KEY = "minibrain.machines.widths";

function modelsMin(width: number): number {
    if (width < SHARE_FROM) {
        return MODELS_MIN;
    }
    const share = Math.round((width * MODELS_SHARE) / 8) * 8;
    return Math.min(MODELS_MAX, Math.max(MODELS_MIN, share));
}

function useBoxWidth() {
    const [box, setBox] = useState<HTMLElement | null>(null);
    const [width, setWidth] = useState(0);
    useEffect(() => {
        if (!box) {
            return;
        }
        const read = () => setWidth(box.clientWidth);
        read();
        const observer = new ResizeObserver(read);
        observer.observe(box);
        return () => observer.disconnect();
    }, [box]);
    return { width, setBox };
}

export function usePoolSizing(
    rows: MachineRow[],
    problems: Problem[] | undefined,
    fit: boolean,
): ColumnSizing {
    const { width, setBox } = useBoxWidth();
    const models = modelsMin(width);
    const columns = useMemo(
        () =>
            COLUMNS.map((column) =>
                column.flex ? { ...column, width: models, min: models } : column,
            ),
        [models],
    );
    const ids = rows.map((row) => row.node.id).join(",");
    const found = (problems ?? []).map((problem) => problem.id).join(",");
    const sizing = useColumnSizing({
        columns,
        storageKey: WIDTHS_KEY,
        fitKey: fit ? `${ids}|${found}|${models}` : undefined,
    });
    const { tableRef } = sizing;
    const observe = useCallback(
        (table: HTMLTableElement | null) => {
            tableRef(table);
            setBox(table?.parentElement ?? null);
        },
        [tableRef, setBox],
    );
    return { ...sizing, tableRef: observe };
}

function PoolModels({ pool }: { pool: PoolInfo }) {
    const deployed = pool.deployed ?? [];
    if (deployed.length === 0) {
        return null;
    }
    return (
        <Tip
            tip={
                <ul className="flex flex-col gap-1">
                    {deployed.map((model) => (
                        <li key={model.model}>{versioned(model.name, model.version)}</li>
                    ))}
                </ul>
            }
        >
            <span className="cursor-default text-muted-foreground tabular-nums">
                {plural(deployed.length, "model")}
            </span>
        </Tip>
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
    const memory = poolMemory(rows);
    const jobs = rows.reduce((sum, row) => sum + row.node.jobs.length, 0);
    return (
        <TableRow
            id={`pool-${pool.name}`}
            className={cn(
                ROW,
                "scroll-mt-24 bg-muted transition-colors duration-150 hover:bg-muted data-flash:bg-highlight motion-reduce:transition-none",
            )}
        >
            <TableCell colSpan={POOL_LEAD} className={CELL}>
                <span className={LEADING}>
                    <RowToggle
                        open={open}
                        label={`${open ? "Hide" : "Show"} machines of ${pool.name}`}
                        onToggle={() => onToggle(!open)}
                    />
                    <Lead>
                        <IconStack2 aria-hidden="true" className="size-4 text-muted-foreground" />
                    </Lead>
                    <PoolLink name={pool.name} className="shrink-0 font-medium" />
                    <UseBadge workloads={pool.workloads} />
                    {pool.description && <PoolDescription text={pool.description} />}
                    <ProblemBadge problems={problems} />
                    <span className="shrink-0 text-sm">
                        <OnlineCount nodes={pool.nodes} />
                    </span>
                </span>
            </TableCell>
            <TableCell data-column="memory" className={CELL}>
                {memory && (
                    <MemoryFigure
                        used={memory.used}
                        capacity={memory.capacity}
                        basis={memory.basis}
                        host={pool.name}
                    />
                )}
            </TableCell>
            <TableCell className={CELL} />
            <TableCell className={CELL} />
            <TableCell className={CELL}>
                <PoolModels pool={pool} />
            </TableCell>
            <TableCell data-column="jobs" className={CELL}>
                <span className="flex min-w-0 items-center justify-between gap-2">
                    <span className="truncate text-muted-foreground tabular-nums">
                        {jobs > 0 ? `${count(jobs)} running` : ""}
                    </span>
                    {admin && <PoolRowMenu pool={pool} token={token} />}
                </span>
            </TableCell>
        </TableRow>
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
            <TableCell data-column="host" className={CELL}>
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
                    <span
                        className={cn(
                            "min-w-0 truncate font-mono",
                            node.online && "text-foreground",
                        )}
                        title={node.host}
                    >
                        {node.host}
                    </span>
                </span>
            </TableCell>
            <TableCell data-column="status" className={CELL}>
                <StatusCell items={machineStatuses(row, problems)} />
            </TableCell>
            <TableCell data-column="gpu" className={CELL}>
                <span className="block truncate" title={gpuText(node)}>
                    {gpuText(node, true)}
                </span>
            </TableCell>
            <TableCell data-column="memory" className={CELL}>
                {memory && (
                    <MemoryFigure
                        used={memory.used}
                        capacity={memory.capacity}
                        basis={memory.basis}
                        host={node.host}
                    />
                )}
            </TableCell>
            <TableCell data-column="cpu" className={NUMBER}>
                {cpu !== null && (
                    <UsagePercent
                        fraction={cpu / 100}
                        tip={`CPU ${Math.round(cpu)}% busy across ${plural(node.cpu_count, "core")}`}
                    />
                )}
            </TableCell>
            <TableCell data-column="ram" className={NUMBER}>
                {ram.used !== null && ram.total ? (
                    <UsagePercent
                        fraction={shareOf(ram.used, ram.total)}
                        tip={`${bytes(ram.used)} of ${bytes(ram.total)} RAM in use`}
                    />
                ) : null}
            </TableCell>
            <TableCell className={CELL}>
                {node.online && <ModelChips chips={modelChips(row)} host={node.host} />}
            </TableCell>
            <TableCell data-column="jobs" className={CELL}>
                <JobsCell jobs={jobChips(node)} />
            </TableCell>
        </TableRow>
    );
}

function SubRow({
    lead,
    name,
    status,
    detail,
}: {
    lead: ReactNode;
    name: ReactNode;
    status: ReactNode;
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
            <TableCell className={CELL}>{status}</TableCell>
            <TableCell colSpan={SPAN - 2} className={CELL}>
                <span className="block truncate text-muted-foreground">{detail}</span>
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
                        status={
                            <StatusText tone={state.tone} active={state.active}>
                                {state.label}
                            </StatusText>
                        }
                        detail={`${engineDetail(engines.length, engines[0].engine)} on ${engines[0].base_model}`}
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
                        status={
                            <StatusText tone={state.tone} active={state.active}>
                                {state.label}
                            </StatusText>
                        }
                        detail={`No model deployed · ${engineLabel(engine.engine)}`}
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
                    status={
                        <StatusText
                            tone="info"
                            active
                            progress={job.progress > 0 ? percentOf(job.progress) : null}
                        >
                            {kindNoun(job.kind)}
                        </StatusText>
                    }
                    detail={
                        <>
                            <span className="tabular-nums">{`${Math.round(job.progress * 100)}% done · `}</span>
                            <Link href={jobHref(job)} className={LINK}>
                                {`Job ${job.id}`}
                            </Link>
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
            ...sortRows(rows, sort, problems).flatMap((row) => {
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
    sort,
    onSort,
    open,
    onOpen,
    sizing,
    empty,
}: {
    pools: PoolInfo[];
    shown: MachineRow[];
    problems: Problem[] | undefined;
    admin: boolean;
    tokens: PoolToken[] | undefined;
    sort: Sort | null;
    onSort: (key: SortKey) => void;
    open: OpenRows;
    onOpen: (row: MachineRow) => void;
    sizing: ColumnSizing;
    empty: ReactNode;
}) {
    const body = bodyRows({ pools, shown, problems, admin, tokens, sort, open, onOpen });
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
                            sort={sort}
                            onSort={onSort}
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
