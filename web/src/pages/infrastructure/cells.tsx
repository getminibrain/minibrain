import {
    ColumnResizer,
    type ColumnSizing,
    Link,
    Popover,
    PopoverContent,
    PopoverTrigger,
    SortButton,
    StatusDot,
    TableHead,
    Tooltip,
    TooltipContent,
    TooltipTrigger,
    cn,
    sortAria,
} from "obp-ui";
import { type ReactNode, useLayoutEffect, useRef, useState } from "react";
import type { Problem } from "~/api/problemQueries";
import { PublisherLogo } from "~/components/PublisherLogo";
import { BASIS_HINTS, type GaugeBasis } from "~/components/UsageGauge";
import { StatusText, percentOf } from "~/components/models/StatusText";
import { count } from "~/lib/format";
import { kindNoun } from "~/lib/jobs";
import { bytes } from "~/lib/time";
import { versioned } from "./activity";
import {
    type Chip,
    type JobChip,
    type StatusItem,
    machineStatuses,
    memoryText,
    percentText,
    shareOf,
} from "./fleet";
import type { MachineRow } from "./machines";
import type { Sort, SortKey } from "./sorting";

const CHIP_GAP = 8;
const MIN_CHIP = 80;
const WARN_AT = 0.9;
const MORE =
    "shrink-0 rounded-sm text-sm text-muted-foreground tabular-nums outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring";

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

function TipList({ items }: { items: { key: string; text: string }[] }) {
    return (
        <ul className="flex flex-col gap-1">
            {items.map((item) => (
                <li key={item.key}>{item.text}</li>
            ))}
        </ul>
    );
}

export function StatusCell({ items, dot = true }: { items: StatusItem[]; dot?: boolean }) {
    const [first, ...rest] = items;
    const label = <span className="truncate">{first.label}</span>;
    return (
        <span className="flex min-w-0 items-center gap-2">
            <Tip tip={first.tip}>
                <span className="flex min-w-0 cursor-default">
                    {dot ? (
                        <StatusText tone={first.tone} active={first.active} className="min-w-0">
                            {label}
                        </StatusText>
                    ) : (
                        <span className="min-w-0 truncate text-sm text-muted-foreground">
                            {first.label}
                        </span>
                    )}
                </span>
            </Tip>
            {rest.length > 0 && (
                <Tip
                    tip={
                        <TipList items={rest.map((item) => ({ key: item.key, text: item.tip }))} />
                    }
                >
                    <button type="button" data-more-status="" className={MORE}>
                        {`+${count(rest.length)}`}
                    </button>
                </Tip>
            )}
        </span>
    );
}

function ChipBody({ chip }: { chip: Chip }) {
    return (
        <>
            <PublisherLogo name={chip.name} modelKey={chip.model} size="sm" />
            {chip.state.tone !== "success" && (
                <StatusDot
                    tone={chip.state.tone}
                    active={chip.state.active}
                    size="sm"
                    label={chip.state.label}
                />
            )}
            <span className="min-w-0 truncate">{chip.name}</span>
        </>
    );
}

const CHIP = "flex min-w-0 max-w-48 items-center gap-1.5";

function ModelChip({ chip, last }: { chip: Chip; last: boolean }) {
    const tip = `${versioned(chip.name, chip.version)} · ${chip.detail}`;
    return (
        <Tip tip={tip}>
            {chip.href ? (
                <Link
                    href={chip.href}
                    className={cn(
                        CHIP,
                        "rounded-sm outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring",
                        !last && "shrink-0",
                    )}
                >
                    <ChipBody chip={chip} />
                </Link>
            ) : (
                <span className={cn(CHIP, "cursor-default", !last && "shrink-0")}>
                    <ChipBody chip={chip} />
                </span>
            )}
        </Tip>
    );
}

function fitCount(widths: number[], more: number, room: number): number {
    let used = 0;
    for (const [index, width] of widths.entries()) {
        const gap = index > 0 ? CHIP_GAP : 0;
        const tail = index < widths.length - 1 ? CHIP_GAP + more : 0;
        const left = room - used - gap - tail;
        if (width > left) {
            return left >= MIN_CHIP ? index + 1 : Math.max(1, index);
        }
        used += gap + width;
    }
    return widths.length;
}

function useFit(key: string, total: number) {
    const box = useRef<HTMLDivElement>(null);
    const probe = useRef<HTMLDivElement>(null);
    const [shown, setShown] = useState(total);
    useLayoutEffect(() => {
        const container = box.current;
        const measured = probe.current;
        if (!container || !measured || key === "") {
            return;
        }
        const update = () => {
            const widths = [...measured.children].map(
                (child) => child.getBoundingClientRect().width,
            );
            const more = widths.pop() ?? 0;
            setShown(fitCount(widths, more, container.clientWidth));
        };
        update();
        const observer = new ResizeObserver(update);
        observer.observe(container);
        observer.observe(measured);
        return () => observer.disconnect();
    }, [key]);
    return { box, probe, shown: Math.min(shown, total) };
}

function ModelList({ chips }: { chips: Chip[] }) {
    return (
        <ul className="flex flex-col gap-2">
            {chips.map((chip) => (
                <li key={chip.key} className="flex min-w-0 items-center gap-2">
                    <PublisherLogo name={chip.name} modelKey={chip.model} size="sm" />
                    <span className="flex min-w-0 flex-1 flex-col">
                        {chip.href ? (
                            <Link
                                href={chip.href}
                                className="truncate text-primary hover:underline"
                            >
                                {versioned(chip.name, chip.version)}
                            </Link>
                        ) : (
                            <span className="truncate font-mono">{chip.name}</span>
                        )}
                        <span className="truncate text-sm text-muted-foreground">{chip.where}</span>
                    </span>
                    <StatusText
                        tone={chip.state.tone}
                        active={chip.state.active}
                        className="shrink-0 text-sm"
                    >
                        {chip.state.label}
                    </StatusText>
                </li>
            ))}
        </ul>
    );
}

function MoreModels({ chips, hidden, host }: { chips: Chip[]; hidden: number; host: string }) {
    const [open, setOpen] = useState(false);
    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger
                openOnHover
                delay={150}
                data-more-models=""
                aria-label={`${count(hidden)} more models on ${host}`}
                className={MORE}
            >
                {`+${count(hidden)}`}
            </PopoverTrigger>
            <PopoverContent align="end" className="w-80" initialFocus={false}>
                <div className="flex flex-col gap-3">
                    <span className="font-medium">{`${count(chips.length)} models on ${host}`}</span>
                    <ModelList chips={chips} />
                </div>
            </PopoverContent>
        </Popover>
    );
}

export function ModelChips({ chips, host }: { chips: Chip[]; host: string }) {
    const key = chips.map((chip) => `${chip.key}:${chip.state.label}`).join("|");
    const { box, probe, shown } = useFit(key, chips.length);
    if (chips.length === 0) {
        return null;
    }
    const visible = chips.slice(0, shown);
    const hidden = chips.length - visible.length;
    return (
        <div ref={box} className="relative flex min-w-0 items-center gap-2 overflow-hidden">
            <div
                ref={probe}
                aria-hidden="true"
                className="invisible absolute top-0 left-0 flex w-max items-center"
            >
                {chips.map((chip) => (
                    <span key={chip.key} className={cn(CHIP, "shrink-0")}>
                        <ChipBody chip={chip} />
                    </span>
                ))}
                <span className="text-sm tabular-nums">{`+${count(chips.length)}`}</span>
            </div>
            {visible.map((chip, index) => (
                <ModelChip key={chip.key} chip={chip} last={index === visible.length - 1} />
            ))}
            {hidden > 0 && <MoreModels chips={chips} hidden={hidden} host={host} />}
        </div>
    );
}

function jobText(chip: JobChip): string {
    return `${kindNoun(chip.job.kind)} · ${chip.subject} · ${Math.round(chip.job.progress * 100)}%`;
}

export function JobsCell({ jobs }: { jobs: JobChip[] }) {
    const [first, ...rest] = jobs;
    if (!first) {
        return null;
    }
    const done = Math.round(first.job.progress * 100);
    return (
        <span className="@container flex w-full min-w-0 items-center gap-2">
            <Link
                href={first.href}
                title={`${jobText(first)} · job ${first.job.id}`}
                className="flex min-w-0 items-center gap-1.5 overflow-hidden rounded-sm outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
            >
                <StatusDot
                    tone="info"
                    active
                    progress={first.job.progress > 0 ? percentOf(first.job.progress) : null}
                    size="sm"
                />
                <span className="shrink-0 @max-[12rem]:hidden">{kindNoun(first.job.kind)}</span>
                <span className="shrink-0 text-muted-foreground @max-[12rem]:hidden">·</span>
                <span className="min-w-0 truncate">{first.subject}</span>
                <span className="shrink-0 text-muted-foreground">·</span>
                <span className="shrink-0 tabular-nums">{`${done}%`}</span>
            </Link>
            {rest.length > 0 && (
                <Tip
                    tip={
                        <TipList
                            items={rest.map((chip) => ({ key: chip.key, text: jobText(chip) }))}
                        />
                    }
                >
                    <button type="button" className={MORE}>
                        {`+${count(rest.length)}`}
                    </button>
                </Tip>
            )}
        </span>
    );
}

export function UsagePercent({ fraction, tip }: { fraction: number; tip: string }) {
    return (
        <Tip tip={tip}>
            <span className={cn("cursor-default", fraction >= WARN_AT && "text-warning")}>
                {percentText(fraction)}
            </span>
        </Tip>
    );
}

function fillOf(fraction: number): string {
    if (fraction >= 0.95) {
        return "bg-destructive";
    }
    return fraction >= 0.85 ? "bg-warning" : "bg-primary";
}

function MeterBar({
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
                    <span className="tabular-nums">{memoryText(used, capacity)}</span>
                    {basis === "estimated" && (
                        <span className="text-muted-foreground">{`Estimated. ${BASIS_HINTS.estimated}`}</span>
                    )}
                </span>
            }
        >
            <span className="flex min-w-0 cursor-default items-center gap-2">
                <MeterBar
                    used={used}
                    capacity={capacity}
                    label={`${host} memory`}
                    className="w-12 shrink-0"
                />
                <span className="tabular-nums">{percentText(shareOf(used, capacity))}</span>
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
    sizing,
}: {
    label: string;
    sortKey: SortKey;
    sort: Sort | null;
    onSort: (key: SortKey) => void;
    numeric?: boolean;
    sizing?: ColumnSizing;
}) {
    const direction = sort?.key === sortKey ? (sort.desc ? "desc" : "asc") : false;
    const handle = sizing?.handle(sortKey, label);
    return (
        <TableHead
            data-column={sortKey}
            aria-sort={sortAria(direction)}
            className={cn("relative overflow-hidden", numeric && "text-right")}
        >
            <SortButton
                direction={direction}
                onClick={() => onSort(sortKey)}
                className={cn(direction && "text-foreground")}
            >
                {label}
            </SortButton>
            {handle && <ColumnResizer {...handle} />}
        </TableHead>
    );
}

export function Lead({ children }: { children?: ReactNode }) {
    return <span className="flex w-5 shrink-0 items-center justify-center">{children}</span>;
}

export function MachineLabel({ row, problems }: { row: MachineRow; problems: Problem[] }) {
    const items = machineStatuses(row, problems);
    const [worst] = items;
    return (
        <span className="flex min-w-0 items-center gap-2">
            <Lead>
                <StatusDot tone={worst.tone} active={worst.active} label={worst.label} />
            </Lead>
            <span
                className={cn("min-w-0 truncate font-mono", row.node.online && "text-foreground")}
                title={row.node.host}
            >
                {row.node.host}
            </span>
            {worst.key !== "ready" && <StatusCell items={items} dot={false} />}
        </span>
    );
}
