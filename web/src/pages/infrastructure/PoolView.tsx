import { IconStack2 } from "@tabler/icons-react";
import {
    type ColumnSize,
    type ColumnSizing,
    Table,
    TableBody,
    TableCell,
    TableFooter,
    TableHeader,
    TableRow,
    cn,
    useColumnSizing,
} from "obp-ui";
import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import type { PoolToken } from "~/api/joinTokenQueries";
import { type Problem, problemsOfMachine } from "~/api/problemQueries";
import { PoolLink } from "~/components/PoolLink";
import { count } from "~/lib/format";
import { bytes } from "~/lib/time";
import { PoolRowMenu } from "./PoolRowMenu";
import { PoolDescription, UseBadge } from "./PoolUse";
import { versioned } from "./activity";
import {
    FitText,
    Lead,
    MemoryCell,
    RunningChips,
    SortHead,
    StatusCell,
    Tip,
    UsagePercent,
} from "./cells";
import {
    capacityOf,
    cpuOf,
    gpuCount,
    gpuText,
    jobChips,
    machineStatuses,
    memoryOf,
    modelChips,
    offlineCapacity,
    poolMemory,
    poolProblems,
    ramOf,
    runningText,
    shareOf,
} from "./fleet";
import type { MachineRow } from "./machines";
import {
    OfflineCount,
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
    { id: "host", label: "Machine", width: 176, min: 104 },
    { id: "status", label: "Status", width: 120, min: 96 },
    { id: "gpu", label: "GPU", width: 96, min: 80 },
    { id: "memory", label: "GPU memory", width: 168, min: 136 },
    { id: "cpu", label: "CPU", width: 74, min: 74, numeric: true },
    { id: "ram", label: "RAM", width: 76, min: 76, numeric: true },
    { id: "running", label: "Running", width: 240, min: 240, flex: true },
];

const RUNNING_MIN = 240;
const RUNNING_SHARE = 0.3;
const SHARE_FROM = 1100;

const SPAN = COLUMNS.length;
const POOL_LEAD = 3;
const ROW = "h-10";
const CELL = "py-1";
const NUMBER = "py-1 text-right tabular-nums";
const LEADING = "flex min-w-0 items-center gap-2";
const WIDTHS_KEY = "minibrain.machines.columns";

function runningMin(width: number): number {
    if (width < SHARE_FROM) {
        return RUNNING_MIN;
    }
    return Math.max(RUNNING_MIN, Math.round((width * RUNNING_SHARE) / 8) * 8);
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
    const running = runningMin(width);
    const columns = useMemo(
        () =>
            COLUMNS.map((column) =>
                column.flex ? { ...column, width: running, min: running } : column,
            ),
        [running],
    );
    const ids = rows.map((row) => row.node.id).join(",");
    const found = (problems ?? []).map((problem) => problem.id).join(",");
    const sizing = useColumnSizing({
        columns,
        storageKey: WIDTHS_KEY,
        fitKey: fit ? `${ids}|${found}|${running}` : undefined,
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

function jobsOf(rows: MachineRow[]): number {
    return rows.reduce((sum, row) => sum + (row.node.online ? row.node.jobs.length : 0), 0);
}

function RunningSummary({
    models,
    jobs,
}: {
    models: { key: string; text: string }[];
    jobs: number;
}) {
    const text = runningText(models.length, jobs);
    if (text === "") {
        return null;
    }
    const summary = (
        <span className="min-w-0 cursor-default truncate text-muted-foreground tabular-nums">
            {text}
        </span>
    );
    if (models.length === 0) {
        return summary;
    }
    return (
        <Tip
            tip={
                <ul className="flex flex-col gap-1">
                    {models.map((model) => (
                        <li key={model.key}>{model.text}</li>
                    ))}
                </ul>
            }
        >
            {summary}
        </Tip>
    );
}

function deployedOf(pools: PoolInfo[]): { key: string; text: string }[] {
    const found = new Map<string, string>();
    for (const pool of pools) {
        for (const model of pool.deployed ?? []) {
            found.set(model.model, versioned(model.name, model.version));
        }
    }
    return [...found.entries()].map(([key, text]) => ({ key, text }));
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
                    <OfflineCount nodes={pool.nodes} />
                </span>
            </TableCell>
            <TableCell data-column="memory" className={CELL}>
                <MemoryCell
                    memory={poolMemory(rows)}
                    offline={offlineCapacity(rows)}
                    label={`Pool ${pool.name} GPU memory`}
                />
            </TableCell>
            <TableCell className={CELL} />
            <TableCell className={CELL} />
            <TableCell className={CELL}>
                <span className="flex min-w-0 items-center justify-between gap-2">
                    <RunningSummary models={deployedOf([pool])} jobs={jobsOf(rows)} />
                    {admin && (
                        <span className="ml-auto flex shrink-0">
                            <PoolRowMenu pool={pool} token={token} />
                        </span>
                    )}
                </span>
            </TableCell>
        </TableRow>
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
    const cpu = cpuOf(node);
    const ram = ramOf(node);
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
                <span className={LEADING}>
                    <span className="w-6 shrink-0" />
                    <FitText
                        text={node.host}
                        className={cn("font-mono", node.online && "text-foreground")}
                    />
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
                <MemoryCell
                    memory={memoryOf(row)}
                    offline={node.online ? null : capacityOf(node)}
                    label={`${node.host} GPU memory`}
                />
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
                {node.online && (
                    <RunningChips models={modelChips(row)} jobs={jobChips(node)} host={node.host} />
                )}
            </TableCell>
        </TableRow>
    );
}

function TotalsRow({ pools, rows }: { pools: PoolInfo[]; rows: MachineRow[] }) {
    const online = rows.filter((row) => row.node.online).length;
    const gpus = rows.reduce((sum, row) => sum + gpuCount(row.node), 0);
    return (
        <TableFooter className="bg-transparent font-normal text-muted-foreground">
            <TableRow className={cn(ROW, "hover:bg-transparent")}>
                <TableCell data-column="host" className={CELL}>
                    <span className={LEADING}>
                        <span className="w-6 shrink-0" />
                        Total
                    </span>
                </TableCell>
                <TableCell data-column="status" className={CELL}>
                    {`${count(online)} of ${count(rows.length)} online`}
                </TableCell>
                <TableCell data-column="gpu" className={CELL}>
                    {plural(gpus, "GPU")}
                </TableCell>
                <TableCell data-column="memory" className={CELL}>
                    <MemoryCell
                        memory={poolMemory(rows)}
                        offline={offlineCapacity(rows)}
                        label="Total GPU memory"
                    />
                </TableCell>
                <TableCell className={CELL} />
                <TableCell className={CELL} />
                <TableCell className={CELL}>
                    <RunningSummary models={deployedOf(pools)} jobs={jobsOf(rows)} />
                </TableCell>
            </TableRow>
        </TableFooter>
    );
}

function bodyRows({
    groups,
    problems,
    admin,
    tokens,
    sort,
    open,
    onOpen,
}: {
    groups: { pool: PoolInfo; rows: MachineRow[] }[];
    problems: Problem[] | undefined;
    admin: boolean;
    tokens: PoolToken[] | undefined;
    sort: Sort | null;
    open: OpenRows;
    onOpen: (row: MachineRow) => void;
}): ReactNode[] {
    return groups.flatMap(({ pool, rows }) => {
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
            ...sortRows(rows, sort, problems).map((row) => (
                <MachineLine
                    key={`machine:${row.node.id}`}
                    row={row}
                    problems={problemsOfMachine(problems, row.node.id)}
                    onOpen={onOpen}
                />
            )),
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
    const groups = pools
        .map((pool) => ({ pool, rows: shown.filter((row) => row.pool.name === pool.name) }))
        .filter((group) => group.rows.length > 0);
    const body = bodyRows({ groups, problems, admin, tokens, sort, open, onOpen });
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
            {groups.length > 1 && (
                <TotalsRow pools={groups.map((group) => group.pool)} rows={shown} />
            )}
        </Table>
    );
}
