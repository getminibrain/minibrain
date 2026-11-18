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
import { type PointerEvent, type ReactNode, useLayoutEffect, useRef, useState } from "react";
import type { Problem } from "~/api/problemQueries";
import { PublisherLogo } from "~/components/PublisherLogo";
import { BASIS_HINTS } from "~/components/UsageGauge";
import { StatusText, percentOf } from "~/components/models/StatusText";
import { count } from "~/lib/format";
import { kindNoun } from "~/lib/jobs";
import { versioned } from "./activity";
import {
    type Chip,
    type JobChip,
    type Memory,
    type StatusItem,
    machineStatuses,
    memoryPair,
    percentText,
    runningText,
    shareOf,
    sizeText,
} from "./fleet";
import type { MachineRow } from "./machines";
import type { Sort, SortKey } from "./sorting";

const CHIP_GAP = 8;
const MIN_CHIP = 80;
const WARN_AT = 0.9;
const MORE =
    "shrink-0 rounded-sm text-sm text-muted-foreground tabular-nums outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring";
const CHIP = "flex min-w-0 max-w-48 items-center gap-1.5";
const CHIP_LINK =
    "rounded-sm outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring";

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

export function FitText({ text, className }: { text: string; className?: string }) {
    const label = (event: PointerEvent<HTMLSpanElement>) => {
        const element = event.currentTarget;
        element.title = element.scrollWidth > element.clientWidth ? text : "";
    };
    return (
        <span onPointerEnter={label} className={cn("min-w-0 truncate", className)}>
            {text}
        </span>
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

function ModelBody({ chip }: { chip: Chip }) {
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

function jobProgress(chip: JobChip): number | null {
    return chip.job.progress > 0 ? percentOf(chip.job.progress) : null;
}

function JobBody({ chip }: { chip: JobChip }) {
    return (
        <>
            <StatusDot tone="info" active progress={jobProgress(chip)} size="sm" />
            <span className="min-w-0 truncate">{chip.subject}</span>
            <span className="shrink-0 text-muted-foreground tabular-nums">{chip.done}</span>
        </>
    );
}

function ModelChip({ chip, last }: { chip: Chip; last: boolean }) {
    const tip = `${versioned(chip.name, chip.version)} · ${chip.detail}`;
    return (
        <Tip tip={tip}>
            {chip.href ? (
                <Link href={chip.href} className={cn(CHIP, CHIP_LINK, !last && "shrink-0")}>
                    <ModelBody chip={chip} />
                </Link>
            ) : (
                <span className={cn(CHIP, "cursor-default", !last && "shrink-0")}>
                    <ModelBody chip={chip} />
                </span>
            )}
        </Tip>
    );
}

function JobChipLink({ chip, last }: { chip: JobChip; last: boolean }) {
    return (
        <Tip tip={chip.tip}>
            <Link href={chip.href} className={cn(CHIP, CHIP_LINK, !last && "shrink-0")}>
                <JobBody chip={chip} />
            </Link>
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

function ModelItem({ chip }: { chip: Chip }) {
    return (
        <li className="flex min-w-0 items-center gap-2">
            <PublisherLogo name={chip.name} modelKey={chip.model} size="sm" />
            <span className="flex min-w-0 flex-1 flex-col">
                {chip.href ? (
                    <Link href={chip.href} className="truncate text-primary hover:underline">
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
    );
}

function JobItem({ chip }: { chip: JobChip }) {
    return (
        <li className="flex min-w-0 items-center gap-2">
            <span className="flex size-5 shrink-0 items-center justify-center">
                <StatusDot tone="info" active progress={jobProgress(chip)} />
            </span>
            <span className="flex min-w-0 flex-1 flex-col">
                <Link href={chip.href} className="truncate text-primary hover:underline">
                    {chip.subject}
                </Link>
                <span className="truncate text-sm text-muted-foreground">
                    {`${kindNoun(chip.job.kind)} · job ${chip.job.id}`}
                </span>
            </span>
            <span className="shrink-0 text-sm tabular-nums">{chip.done}</span>
        </li>
    );
}

function MoreRunning({
    models,
    jobs,
    hidden,
    host,
}: {
    models: Chip[];
    jobs: JobChip[];
    hidden: number;
    host: string;
}) {
    const [open, setOpen] = useState(false);
    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger
                openOnHover
                delay={150}
                data-more-running=""
                aria-label={`${count(hidden)} more running on ${host}`}
                className={MORE}
            >
                {`+${count(hidden)}`}
            </PopoverTrigger>
            <PopoverContent align="end" className="w-80" initialFocus={false}>
                <div className="flex flex-col gap-3">
                    <span className="font-medium">{`${runningText(models.length, jobs.length)} on ${host}`}</span>
                    <ul className="flex flex-col gap-2">
                        {models.map((chip) => (
                            <ModelItem key={chip.key} chip={chip} />
                        ))}
                        {jobs.map((chip) => (
                            <JobItem key={chip.key} chip={chip} />
                        ))}
                    </ul>
                </div>
            </PopoverContent>
        </Popover>
    );
}

export function RunningChips({
    models,
    jobs,
    host,
}: {
    models: Chip[];
    jobs: JobChip[];
    host: string;
}) {
    const total = models.length + jobs.length;
    const key = [
        ...models.map((chip) => `${chip.key}:${chip.state.label}`),
        ...jobs.map((chip) => `${chip.key}:${chip.done}`),
    ].join("|");
    const { box, probe, shown } = useFit(key, total);
    if (total === 0) {
        return null;
    }
    const visibleModels = models.slice(0, shown);
    const visibleJobs = jobs.slice(0, Math.max(0, shown - models.length));
    const lastIndex = shown - 1;
    return (
        <div ref={box} className="relative flex min-w-0 items-center gap-2 overflow-hidden">
            <div
                ref={probe}
                aria-hidden="true"
                className="invisible absolute top-0 left-0 flex w-max items-center"
            >
                {models.map((chip) => (
                    <span key={chip.key} className={cn(CHIP, "shrink-0")}>
                        <ModelBody chip={chip} />
                    </span>
                ))}
                {jobs.map((chip) => (
                    <span key={chip.key} className={cn(CHIP, "shrink-0")}>
                        <JobBody chip={chip} />
                    </span>
                ))}
                <span className="text-sm tabular-nums">{`+${count(total)}`}</span>
            </div>
            {visibleModels.map((chip, index) => (
                <ModelChip key={chip.key} chip={chip} last={index === lastIndex} />
            ))}
            {visibleJobs.map((chip, index) => (
                <JobChipLink
                    key={chip.key}
                    chip={chip}
                    last={models.length + index === lastIndex}
                />
            ))}
            {shown < total && (
                <MoreRunning models={models} jobs={jobs} hidden={total - shown} host={host} />
            )}
        </div>
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

function barParts(memory: Memory): { key: string; fraction: number }[] {
    if (memory.gpus.length > 1) {
        return memory.gpus.map((gpu) => ({
            key: `gpu-${gpu.index}`,
            fraction: shareOf(gpu.used, gpu.capacity),
        }));
    }
    return [{ key: "all", fraction: shareOf(memory.used, memory.capacity) }];
}

function MeterBar({ memory, label }: { memory: Memory; label: string }) {
    const { used, capacity } = memory;
    return (
        <span
            role="meter"
            aria-label={label}
            aria-valuemin={0}
            aria-valuemax={Math.max(capacity, 1)}
            aria-valuenow={Math.min(used, capacity)}
            aria-valuetext={`${memoryPair(used, capacity, " of ")} in use`}
            className="flex h-1.5 w-12 shrink-0 gap-0.5"
        >
            {barParts(memory).map((part) => (
                <span
                    key={part.key}
                    className="block h-full min-w-0 flex-1 overflow-hidden rounded-sm bg-secondary"
                >
                    <span
                        className={cn("block h-full", fillOf(part.fraction))}
                        style={{ width: `${Math.min(100, part.fraction * 100)}%` }}
                    />
                </span>
            ))}
        </span>
    );
}

function MemoryTip({ memory }: { memory: Memory }) {
    const { used, capacity, gpus, basis } = memory;
    return (
        <span className="flex flex-col gap-1 tabular-nums">
            <span>{`${memoryPair(used, capacity)} in use · ${percentText(shareOf(used, capacity))}`}</span>
            {gpus.length > 1 &&
                gpus.map((gpu) => (
                    <span key={gpu.index}>
                        {`GPU ${gpu.index} · ${memoryPair(gpu.used, gpu.capacity)} · ${percentText(shareOf(gpu.used, gpu.capacity))}`}
                    </span>
                ))}
            {basis === "estimated" && <span>{`Estimated. ${BASIS_HINTS.estimated}`}</span>}
        </span>
    );
}

function MemoryFigure({ memory, label }: { memory: Memory; label: string }) {
    return (
        <Tip tip={<MemoryTip memory={memory} />}>
            <span className="flex min-w-0 cursor-default items-center gap-2">
                <MeterBar memory={memory} label={label} />
                <span className="truncate tabular-nums">
                    {memoryPair(memory.used, memory.capacity)}
                </span>
            </span>
        </Tip>
    );
}

export function MemoryCell({
    memory,
    offline,
    label,
}: {
    memory: Memory | null;
    offline: number | null;
    label: string;
}) {
    if (memory) {
        return <MemoryFigure memory={memory} label={label} />;
    }
    return offline ? (
        <span className="text-muted-foreground tabular-nums">{sizeText(offline)}</span>
    ) : null;
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
