import { IconStack2 } from "@tabler/icons-react";
import {
    type ColumnSize,
    type ColumnSizing,
    Link,
    SegmentedTabs,
    Table,
    TableBody,
    TableCell,
    TableHeader,
    TableRow,
    cn,
    useColumnSizing,
} from "obp-ui";
import { Fragment, type ReactNode } from "react";
import type { PoolToken } from "~/api/joinTokenQueries";
import { type Problem, problemsOfMachine } from "~/api/problemQueries";
import { PublisherLogo } from "~/components/PublisherLogo";
import { StatusText, percentOf } from "~/components/models/StatusText";
import { count } from "~/lib/format";
import { kindNoun } from "~/lib/jobs";
import { jobHref } from "~/lib/modelLinks";
import { bytes } from "~/lib/time";
import { ModelTable } from "../ModelView";
import { UseBadge } from "../PoolUse";
import { engineLabel, jobLink, jobSubject, servedHref, versioned, worstState } from "../activity";
import {
    type DeployedModel,
    type ShownGroup,
    modelGroups,
    servedOn,
    shownGroups,
} from "../byModel";
import {
    Dash,
    JobProgressChip,
    Lead,
    MachineLabel,
    MemoryFigure,
    ModelsCell,
    SortHead,
    Tip,
} from "../cells";
import {
    cpuOf,
    gpuText,
    jobChips,
    memoryOf,
    percentText,
    poolMemory,
    poolProblems,
    ramOf,
    shareOf,
} from "../fleet";
import type { MachineRow } from "../machines";
import {
    OnlineCount,
    type OpenRows,
    type PoolInfo,
    ProblemBadge,
    RowToggle,
    plural,
    rowEvents,
} from "../parts";
import { type Sort, type SortKey, sortRows } from "../sorting";
import { PoolRowMenu } from "./PoolRowMenu";
import {
    MachineToolbar,
    type MachinesView,
    ViewMenu,
    WIDTHS_KEY,
    emptyText,
    fitKeyOf,
    useMachineFilters,
} from "./shared";

const COLUMNS: (ColumnSize & { id: SortKey; label: string; numeric?: boolean })[] = [
    { id: "host", label: "Machine", width: 200, min: 160 },
    { id: "gpu", label: "GPU", width: 88, min: 64 },
    { id: "memory", label: "GPU memory", width: 128, min: 104 },
    { id: "cpu", label: "CPU", width: 64, min: 56, numeric: true },
    { id: "ram", label: "RAM", width: 64, min: 56, numeric: true },
    { id: "models", label: "Models", width: 240, min: 200, flex: true },
    { id: "jobs", label: "Jobs", width: 120, min: 104 },
];

const SPAN = COLUMNS.length;
const DETAIL = SPAN - 1;
const MAX_AVATARS = 5;
const LINK = "text-primary hover:underline";
const ROW = "h-10";
const CELL = "py-1";
const NUMBER = "py-1 text-right tabular-nums";
const LEADING = "flex min-w-0 items-center gap-2";
const MODEL_VIEW = "model";
const GROUPS = [
    { key: "pool", label: "Pool" },
    { key: MODEL_VIEW, label: "Model" },
];

function PoolModels({ deployed }: { deployed: DeployedModel[] }) {
    if (deployed.length === 0) {
        return null;
    }
    const shown = deployed.slice(0, MAX_AVATARS);
    return (
        <span className="flex min-w-0 items-center gap-1">
            {shown.map((model) => (
                <Tip key={model.model} tip={versioned(model.name, model.version)}>
                    <span className="flex shrink-0 cursor-default">
                        <PublisherLogo name={model.name} modelKey={model.model} size="sm" />
                    </span>
                </Tip>
            ))}
            {deployed.length > shown.length && (
                <Tip
                    tip={deployed
                        .slice(MAX_AVATARS)
                        .map((model) => versioned(model.name, model.version))
                        .join(", ")}
                >
                    <span className="shrink-0 cursor-default text-sm text-muted-foreground tabular-nums">{`+${count(deployed.length - shown.length)}`}</span>
                </Tip>
            )}
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
            <TableCell colSpan={2} className={CELL}>
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
                <PoolModels deployed={pool.deployed ?? []} />
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
                    <MachineLabel row={row} problems={problems} />
                </span>
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
            <TableCell data-column="cpu" className={NUMBER}>
                {cpu === null ? <Dash /> : `${Math.round(cpu)}%`}
            </TableCell>
            <TableCell data-column="ram" className={NUMBER}>
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
            <TableCell data-column="jobs" className={CELL}>
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

function PoolTable({
    view,
    shown,
    sizing,
    empty,
}: {
    view: MachinesView;
    shown: MachineRow[];
    sizing: ColumnSizing;
    empty: ReactNode;
}) {
    const body = bodyRows({
        pools: view.pools,
        shown,
        problems: view.problems,
        admin: view.admin,
        tokens: view.tokens,
        sort: view.sort,
        open: view.open,
        onOpen: view.onOpen,
    });
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

function unlistedParts(rows: MachineRow[], groups: ShownGroup[]): string[] {
    const listed = new Set(
        groups.flatMap(({ places }) =>
            places.flatMap((place) => place.machines.map((machine) => machine.row.node.id)),
        ),
    );
    const unlisted = rows.filter((row) => !listed.has(row.node.id));
    const idle = unlisted.filter((row) => row.node.jobs.length === 0).length;
    const jobsOnly = unlisted.length - idle;
    return [
        idle > 0 ? plural(idle, "idle machine") : null,
        jobsOnly > 0 ? `${plural(jobsOnly, "machine")} running jobs only` : null,
    ].filter((part): part is string => part !== null);
}

export function RefinedLayout({ view }: { view: MachinesView }) {
    const filtered = useMachineFilters(view);
    const byModel = view.search.group === MODEL_VIEW;
    const sizing = useColumnSizing({
        columns: COLUMNS,
        storageKey: WIDTHS_KEY,
        fitKey: byModel ? undefined : fitKeyOf(filtered.shown, view.problems),
    });
    const groups = byModel ? shownGroups(modelGroups(view.pools, view.all), filtered.filters) : [];
    const unlisted = byModel ? unlistedParts(filtered.shown, groups) : [];
    const empty =
        byModel && !view.loading && !filtered.filtering
            ? "No model is deployed."
            : emptyText(view, filtered);
    return (
        <>
            <MachineToolbar
                view={view}
                filtered={filtered}
                placeholder={byModel ? "Search by model or machine" : "Search by machine name"}
                end={
                    <>
                        <span className="text-muted-foreground">Group by</span>
                        <SegmentedTabs
                            size="sm"
                            tabs={GROUPS}
                            active={byModel ? MODEL_VIEW : "pool"}
                            onSelect={(key) =>
                                view.update({ group: key === MODEL_VIEW ? key : "" })
                            }
                        />
                        {!byModel && <ViewMenu sizing={sizing} />}
                    </>
                }
            />
            <div className="overflow-hidden rounded-md border bg-card">
                {byModel ? (
                    <ModelTable
                        groups={groups}
                        problems={view.problems}
                        open={view.open}
                        empty={empty}
                        onOpen={view.onOpen}
                    />
                ) : (
                    <PoolTable view={view} shown={filtered.shown} sizing={sizing} empty={empty} />
                )}
                {unlisted.length > 0 && (
                    <p className="border-t px-3 py-2 text-sm text-muted-foreground">
                        {"Not listed, nothing deployed: "}
                        {unlisted.map((part, index) => (
                            <Fragment key={part}>
                                {index > 0 && " · "}
                                <button
                                    type="button"
                                    className="text-primary hover:underline"
                                    onClick={() => view.update({ group: "" })}
                                >
                                    {part}
                                </button>
                            </Fragment>
                        ))}
                    </p>
                )}
            </div>
        </>
    );
}
