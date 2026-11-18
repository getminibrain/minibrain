import {
    IconAlertTriangle,
    IconArrowDown,
    IconArrowUp,
    IconSelector,
    IconServer,
} from "@tabler/icons-react";
import {
    Badge,
    Link,
    StatusDot,
    TableHead,
    Tooltip,
    TooltipContent,
    TooltipTrigger,
    cn,
} from "obp-ui";
import type { ReactNode } from "react";
import type { Problem } from "~/api/problemQueries";
import { PublisherLogo } from "~/components/PublisherLogo";
import { BASIS_HINTS, type GaugeBasis } from "~/components/UsageGauge";
import { percentOf } from "~/components/models/StatusText";
import { count } from "~/lib/format";
import { kindNoun } from "~/lib/jobs";
import { bytes, exactTime } from "~/lib/time";
import {
    type Chip,
    type JobChip,
    agoText,
    percentText,
    problemLabel,
    problemTone,
    shareOf,
    statusTone,
} from "./fleet";
import type { MachineRow } from "./machines";
import type { Sort, SortKey } from "./sorting";

const CHIP =
    "inline-flex h-6 min-w-0 max-w-full shrink items-center gap-1.5 rounded-md border px-1.5 text-sm outline-none hover:bg-secondary focus-visible:ring-2 focus-visible:ring-ring";

export function Tip({ tip, children }: { tip: ReactNode; children: ReactNode }) {
    return (
        <Tooltip>
            <TooltipTrigger asChild>{children}</TooltipTrigger>
            <TooltipContent className="max-w-xs whitespace-normal">{tip}</TooltipContent>
        </Tooltip>
    );
}

export function Dash() {
    return <span className="text-muted-foreground">–</span>;
}

export function ModelChip({ chip, compact = false }: { chip: Chip; compact?: boolean }) {
    const body = (
        <>
            {chip.state.tone !== "success" && (
                <StatusDot tone={chip.state.tone} active={chip.state.active} size="sm" />
            )}
            <PublisherLogo name={chip.name} modelKey={chip.model} size="sm" />
            {!compact && <span className="min-w-0 truncate">{chip.name}</span>}
            {!compact && chip.version !== null && chip.version !== undefined && (
                <span className="shrink-0 text-muted-foreground tabular-nums">{`v${chip.version}`}</span>
            )}
        </>
    );
    return (
        <Tip tip={`${chip.name}${chip.version ? ` v${chip.version}` : ""} · ${chip.detail}`}>
            {chip.href ? (
                <Link href={chip.href} aria-label={chip.name} className={CHIP}>
                    {body}
                </Link>
            ) : (
                <span className={cn(CHIP, "hover:bg-transparent")}>{body}</span>
            )}
        </Tip>
    );
}

export function JobProgressChip({ chip }: { chip: JobChip }) {
    const done = Math.round(chip.job.progress * 100);
    return (
        <Tip
            tip={`${kindNoun(chip.job.kind)} ${chip.subject} · ${done}% done · job ${chip.job.id}`}
        >
            <Link href={chip.href} className={CHIP}>
                <StatusDot
                    tone="info"
                    active
                    progress={chip.job.progress > 0 ? percentOf(chip.job.progress) : null}
                    size="sm"
                />
                <span className="shrink-0">{kindNoun(chip.job.kind)}</span>
                <span className="min-w-0 truncate text-muted-foreground">{chip.subject}</span>
                <span className="shrink-0 tabular-nums">{`${done}%`}</span>
            </Link>
        </Tip>
    );
}

function fillOf(fraction: number): string {
    if (fraction >= 0.95) {
        return "bg-destructive";
    }
    return fraction >= 0.85 ? "bg-warning" : "bg-primary";
}

export function MeterBar({
    used,
    capacity,
    label,
    className,
}: {
    used: number;
    capacity: number;
    label: string;
    className?: string;
}) {
    const fraction = shareOf(used, capacity);
    return (
        <span
            role="meter"
            aria-label={label}
            aria-valuemin={0}
            aria-valuemax={Math.max(capacity, 1)}
            aria-valuenow={Math.min(used, capacity)}
            aria-valuetext={`${bytes(used)} of ${bytes(capacity)}`}
            className={cn("block h-1.5 overflow-hidden rounded-sm bg-secondary", className)}
        >
            <span
                className={cn("block h-full", fillOf(fraction))}
                style={{ width: `${Math.min(100, fraction * 100)}%` }}
            />
        </span>
    );
}

export function MemoryFigure({
    used,
    capacity,
    basis,
    host,
}: {
    used: number;
    capacity: number;
    basis: GaugeBasis;
    host: string;
}) {
    return (
        <Tip
            tip={
                <span className="flex flex-col gap-1">
                    <span className="tabular-nums">{`${bytes(used)} of ${bytes(capacity)} in use · ${bytes(Math.max(0, capacity - used))} free`}</span>
                    <span className="text-muted-foreground">{BASIS_HINTS[basis]}</span>
                </span>
            }
        >
            <span className="flex min-w-0 cursor-default items-center gap-2">
                <MeterBar
                    used={used}
                    capacity={capacity}
                    label={`${host} memory`}
                    className="w-16 shrink-0"
                />
                <span className="text-sm tabular-nums">{percentText(shareOf(used, capacity))}</span>
                {basis === "estimated" && (
                    <span className="text-sm text-muted-foreground">est.</span>
                )}
            </span>
        </Tip>
    );
}

export function SortHead({
    label,
    sortKey,
    sort,
    onSort,
    numeric = false,
}: {
    label: string;
    sortKey: SortKey;
    sort: Sort | null;
    onSort: (key: SortKey) => void;
    numeric?: boolean;
}) {
    const active = sort?.key === sortKey;
    const Icon = !active ? IconSelector : sort.desc ? IconArrowDown : IconArrowUp;
    return (
        <TableHead
            aria-sort={active ? (sort.desc ? "descending" : "ascending") : "none"}
            className={cn(numeric && "text-right")}
        >
            <button
                type="button"
                onClick={() => onSort(sortKey)}
                className={cn(
                    "inline-flex max-w-full items-center gap-1 rounded-sm outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
                    active && "text-foreground",
                )}
            >
                <span className="truncate">{label}</span>
                {(active || !numeric) && (
                    <Icon
                        aria-hidden="true"
                        className={cn("size-3.5 shrink-0", !active && "text-muted-foreground")}
                    />
                )}
            </button>
        </TableHead>
    );
}

export function ProblemTags({ problems }: { problems: Problem[] }) {
    const shown = problems.filter((problem) => problem.kind !== "machine_offline");
    if (shown.length === 0) {
        return null;
    }
    const [first] = shown;
    return (
        <Tip
            tip={
                <ul className="flex flex-col gap-1">
                    {shown.map((problem) => (
                        <li key={problem.id}>{problem.text}</li>
                    ))}
                </ul>
            }
        >
            <Link
                href={first.href}
                className="flex min-w-0 shrink rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
                <Badge
                    variant={problemTone(shown)}
                    className="min-w-0 max-w-full shrink overflow-hidden tabular-nums"
                >
                    <IconAlertTriangle aria-hidden="true" />
                    <span className="truncate">{problemLabel(first)}</span>
                    {shown.length > 1 && <span>{`+${count(shown.length - 1)}`}</span>}
                </Badge>
            </Link>
        </Tip>
    );
}

export function MachineLabel({ row, problems }: { row: MachineRow; problems: Problem[] }) {
    const { node } = row;
    const status = statusTone(row);
    const draining = node.state === "draining";
    return (
        <span className="flex min-w-0 items-center gap-1.5">
            <Tip tip={status.label}>
                <span className="flex shrink-0 cursor-default">
                    <StatusDot tone={status.tone} active={status.active} label={status.label} />
                </span>
            </Tip>
            <IconServer aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
            <span
                className={cn(
                    "max-w-full shrink-0 truncate font-mono",
                    node.online && "text-foreground",
                )}
            >
                {node.host}
            </span>
            {draining && <span className="shrink-0 text-sm text-warning">{status.label}</span>}
            {!node.online && !draining && (
                <span
                    className="shrink-0 text-sm text-foreground"
                    title={node.seen_at ? exactTime(node.seen_at) : undefined}
                >
                    {`Offline ${agoText(node.seen_at)}`}
                </span>
            )}
            <ProblemTags problems={problems} />
        </span>
    );
}
