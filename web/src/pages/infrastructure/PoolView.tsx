import { IconServer, IconStack2 } from "@tabler/icons-react";
import {
    Link,
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
import type { ReactNode } from "react";
import type { PoolToken } from "~/api/joinTokenQueries";
import { type Problem, problemsOfMachine } from "~/api/problemQueries";
import { PublisherLogo } from "~/components/PublisherLogo";
import { BASIS_HINTS, UsageGauge } from "~/components/UsageGauge";
import { StatusText, percentOf } from "~/components/models/StatusText";
import { count } from "~/lib/format";
import { kindNoun } from "~/lib/jobs";
import { jobHref } from "~/lib/modelLinks";
import { timeText } from "~/lib/time";
import { LOCAL_POOL, PoolJoinControls } from "./PoolJoin";
import {
    ENGINE_DOING,
    type NodeJob,
    engineLabel,
    jobLink,
    jobSubject,
    memoryView,
    servedHref,
    versioned,
    worstKey,
    worstState,
} from "./activity";
import { servedOn } from "./byModel";
import { type MachineRow, hardwareParts, machineStatus } from "./machines";
import {
    type NodeInfo,
    OnlineCount,
    type OpenRows,
    type PoolInfo,
    ProblemBadge,
    RoomLine,
    RowToggle,
    plural,
    rowEvents,
} from "./parts";

const COLUMNS = 6;
const LINK = "text-primary hover:underline";
const SUB_ROW = "border-border-soft hover:bg-transparent";
const SUB_GRID = "grid grid-cols-[9rem_minmax(0,18rem)_minmax(0,1fr)] items-baseline gap-x-4";

function seenText(row: MachineRow): string {
    return row.node.seen_at ? `Seen ${timeText(row.node.seen_at)}` : "Never seen";
}

function hasActivity(row: MachineRow): boolean {
    return row.engines.length > 0 || row.node.jobs.length > 0;
}

type Summary = { key: string; text: string; content: ReactNode };

function summaryItems(row: MachineRow): Summary[] {
    const { models, bare } = servedOn(row.engines);
    const served = models.map(({ served, engines }) => ({
        key: `served-${served.model}`,
        text: `${ENGINE_DOING[worstKey(engines)] ?? "Serving"} ${versioned(served.name, served.version)}`,
        content: (
            <>
                {`${ENGINE_DOING[worstKey(engines)] ?? "Serving"} `}
                <Link href={servedHref(served)} className={LINK}>
                    {versioned(served.name, served.version)}
                </Link>
            </>
        ),
    }));
    const engines = bare.map((engine) => ({
        key: `engine-${engine.id}`,
        text: `${ENGINE_DOING[engine.state] ?? "Running"} ${engine.base_model}`,
        content: (
            <>
                {`${ENGINE_DOING[engine.state] ?? "Running"} `}
                <span className="font-mono">{engine.base_model}</span>
            </>
        ),
    }));
    const jobs = row.node.jobs.map((job) => ({
        key: `job-${job.id}`,
        text: `${kindNoun(job.kind)} ${jobSubject(job)} · ${Math.round(job.progress * 100)}%`,
        content: (
            <>
                {`${kindNoun(job.kind)} `}
                <Link href={jobLink(job)} className={LINK}>
                    {jobSubject(job)}
                </Link>
                <span className="text-muted-foreground tabular-nums">{` · ${Math.round(job.progress * 100)}%`}</span>
            </>
        ),
    }));
    return [...served, ...engines, ...jobs];
}

function RunningCell({ row }: { row: MachineRow }) {
    if (!row.node.online) {
        return <span className="block truncate text-muted-foreground">{seenText(row)}</span>;
    }
    const items = summaryItems(row);
    const [first, ...rest] = items;
    if (first === undefined) {
        return <span className="text-muted-foreground">Idle</span>;
    }
    return (
        <span
            className="flex min-w-0 items-baseline gap-1.5"
            title={items.map((item) => item.text).join("\n")}
        >
            <span className="min-w-0 truncate">{first.content}</span>
            {rest.length > 0 && (
                <span className="shrink-0 text-sm text-muted-foreground tabular-nums">{`+${count(rest.length)}`}</span>
            )}
        </span>
    );
}

function HardwareCell({ node }: { node: NodeInfo }) {
    const { device, memory } = hardwareParts(node);
    const text = memory ? `${device} · ${memory}` : device;
    return (
        <span className="block truncate" title={text}>
            {text}
        </span>
    );
}

function shareText(used: number, total: number): string {
    return `${Math.round(Math.min(used / total, 9.99) * 100)}%`;
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
                className="w-10 shrink-0"
            />
            <Tooltip>
                <TooltipTrigger asChild>
                    <span className="cursor-default truncate text-sm text-muted-foreground tabular-nums">
                        {shareText(view.used, view.capacity)}
                    </span>
                </TooltipTrigger>
                <TooltipContent className="max-w-xs whitespace-normal">
                    {BASIS_HINTS[view.basis]}
                </TooltipContent>
            </Tooltip>
        </span>
    );
}

function GroupRow({
    pool,
    shown,
    admin,
    token,
    open,
    onToggle,
}: {
    pool: PoolInfo;
    shown: number;
    admin: boolean;
    token: PoolToken | undefined;
    open: boolean;
    onToggle: (open: boolean) => void;
}) {
    return (
        <TableRow
            id={`pool-${pool.name}`}
            className="scroll-mt-24 bg-muted transition-colors duration-150 hover:bg-muted has-aria-expanded:bg-muted data-flash:bg-highlight motion-reduce:transition-none"
        >
            <TableCell className="px-2 py-1.5">
                <RowToggle
                    open={open}
                    label={`${open ? "Hide" : "Show"} machines of ${pool.name}`}
                    onToggle={() => onToggle(!open)}
                />
            </TableCell>
            <TableCell colSpan={COLUMNS - 1} className="py-1.5 whitespace-normal">
                <span className="flex flex-wrap items-center gap-x-3 text-sm">
                    <span className="flex items-center gap-2 text-base font-medium text-foreground">
                        <IconStack2 aria-hidden="true" className="size-4 text-muted-foreground" />
                        {pool.name}
                    </span>
                    {pool.label !== pool.name && (
                        <span className="text-muted-foreground">{pool.label}</span>
                    )}
                    <OnlineCount nodes={pool.nodes} />
                    <span className="text-muted-foreground tabular-nums">
                        {plural(pool.engines.length, "engine")}
                    </span>
                    {shown < pool.nodes.length && (
                        <span className="text-muted-foreground tabular-nums">
                            {`${count(shown)} shown`}
                        </span>
                    )}
                    <RoomLine room={pool.room} />
                    {admin && pool.name !== LOCAL_POOL && (
                        <PoolJoinControls pool={pool.name} token={token} />
                    )}
                </span>
            </TableCell>
        </TableRow>
    );
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
    const status = machineStatus(node, row.engines);
    const expandable = hasActivity(row);
    return (
        <TableRow
            {...rowEvents(() => onOpen(row), expandable ? onToggle : undefined)}
            aria-label={`${node.host}, ${status.label.toLowerCase()}`}
            className={cn(
                "cursor-pointer outline-none focus-visible:bg-secondary",
                !node.online && "text-muted-foreground",
            )}
        >
            <TableCell className="px-2 py-2">
                {expandable && (
                    <RowToggle
                        open={open}
                        label={`${open ? "Hide" : "Show"} what runs on ${node.host}`}
                        onToggle={() => onToggle(!open)}
                    />
                )}
            </TableCell>
            <TableCell className="py-2">
                <StatusText tone={status.tone} active={status.active}>
                    {status.label}
                </StatusText>
            </TableCell>
            <TableCell className="py-2">
                <span className="flex min-w-0 items-center gap-2">
                    <IconServer
                        aria-hidden="true"
                        className="size-4 shrink-0 text-muted-foreground"
                    />
                    <span className="max-w-full shrink-0 truncate font-mono text-foreground">
                        {node.host}
                    </span>
                    <ProblemBadge problems={problems} />
                    <span className="min-w-0 truncate text-sm text-muted-foreground">
                        {node.roles.join(", ")}
                    </span>
                </span>
            </TableCell>
            <TableCell className="py-2">
                <HardwareCell node={node} />
            </TableCell>
            <TableCell className="py-2">
                <MemoryCell row={row} />
            </TableCell>
            <TableCell className="py-2">
                <RunningCell row={row} />
            </TableCell>
        </TableRow>
    );
}

function SubRow({ children }: { children: ReactNode }) {
    return (
        <TableRow className={SUB_ROW}>
            <TableCell colSpan={2} className="py-1.5" />
            <TableCell colSpan={COLUMNS - 2} className="py-1.5 pl-6">
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
                        <span className="truncate font-mono">{engine.base_model}</span>
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

export function PoolColumns() {
    return (
        <>
            <colgroup>
                <col className="w-10" />
                <col className="w-36" />
                <col />
                <col className="w-[20%]" />
                <col className="w-44" />
                <col className="w-[26%]" />
            </colgroup>
            <TableHeader>
                <TableRow className="hover:bg-transparent">
                    <TableHead>
                        <span className="sr-only">Expand</span>
                    </TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Machine</TableHead>
                    <TableHead>Hardware</TableHead>
                    <TableHead>Memory</TableHead>
                    <TableHead>Running</TableHead>
                </TableRow>
            </TableHeader>
        </>
    );
}

export function PoolRows({
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
    const body = pools.flatMap((pool) => {
        const rows = shown.filter((row) => row.pool.name === pool.name);
        if (rows.length === 0) {
            return [];
        }
        const poolKey = `pool:${pool.name}`;
        const poolOpen = open.isOpen(poolKey, true);
        const group = (
            <GroupRow
                key={poolKey}
                pool={pool}
                shown={rows.length}
                admin={admin}
                token={tokens?.find((token) => token.pool === pool.name)}
                open={poolOpen}
                onToggle={(next) => open.set(poolKey, next)}
            />
        );
        if (!poolOpen) {
            return [group];
        }
        return [
            group,
            ...rows.flatMap((row) => {
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
    return (
        <TableBody>
            {body.length > 0 ? (
                body
            ) : (
                <TableRow className="hover:bg-transparent">
                    <TableCell colSpan={COLUMNS} className="h-32 text-center text-muted-foreground">
                        {empty}
                    </TableCell>
                </TableRow>
            )}
        </TableBody>
    );
}
