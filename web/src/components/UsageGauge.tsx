import { Tooltip, TooltipContent, TooltipTrigger, cn } from "obp-ui";
import type { CSSProperties } from "react";
import { bytes } from "~/lib/time";

export type GaugeKind =
    | "weights"
    | "adapters"
    | "training"
    | "database"
    | "datasets"
    | "uploads"
    | "minibrain"
    | "measured"
    | "other";

type KindStyle = { label: string; color: string; danger: string };

export const GAUGE_KINDS: Record<GaugeKind, KindStyle> = {
    weights: {
        label: "Model weights",
        color: "var(--chart-memory-1)",
        danger: "var(--chart-memory-over-1)",
    },
    adapters: {
        label: "Adapters",
        color: "var(--chart-memory-2)",
        danger: "var(--chart-memory-over-2)",
    },
    training: {
        label: "Training",
        color: "var(--chart-memory-3)",
        danger: "var(--chart-memory-over-3)",
    },
    database: {
        label: "Database",
        color: "var(--chart-series-4)",
        danger: "var(--destructive)",
    },
    datasets: {
        label: "Dataset versions",
        color: "var(--chart-series-3)",
        danger: "var(--destructive)",
    },
    uploads: {
        label: "Uploads, adapters and results",
        color: "var(--chart-series-2)",
        danger: "var(--destructive)",
    },
    minibrain: {
        label: "minibrain",
        color: "var(--chart-series-5)",
        danger: "var(--destructive)",
    },
    measured: {
        label: "In use (measured)",
        color: "var(--chart-series-5)",
        danger: "var(--destructive)",
    },
    other: { label: "Other files", color: "var(--faint)", danger: "var(--faint)" },
};

export type GaugeBasis = "measured" | "estimated";

export const BASIS_LABELS: Record<GaugeBasis, string> = {
    measured: "Measured",
    estimated: "Estimated",
};

export const BASIS_HINTS: Record<GaugeBasis, string> = {
    measured: "Read from the machine with its last heartbeat.",
    estimated:
        "Worked out from weight and adapter files and each training plan; not read from the machine.",
};

export function BasisLabel({ basis }: { basis: GaugeBasis }) {
    return (
        <Tooltip>
            <TooltipTrigger asChild>
                <span className="cursor-default text-sm text-muted-foreground">
                    {BASIS_LABELS[basis]}
                </span>
            </TooltipTrigger>
            <TooltipContent className="max-w-xs whitespace-normal">
                {BASIS_HINTS[basis]}
            </TooltipContent>
        </Tooltip>
    );
}

export type GaugeSegment = {
    key: string;
    kind: GaugeKind;
    label: string;
    bytes: number;
    legend?: string;
    planned?: boolean;
};

type State = "ok" | "low" | "over";

const FREE_SWATCH = "border bg-secondary";

function share(value: number, total: number): number {
    return total > 0 ? Math.max(0, Math.min(100, (value / total) * 100)) : 0;
}

function colorOf(segment: GaugeSegment, state: State, anyPlanned: boolean): string {
    const style = GAUGE_KINDS[segment.kind];
    const affected = anyPlanned ? segment.planned : true;
    if (state === "over" && affected) {
        return style.danger;
    }
    if (state === "low" && affected) {
        return "var(--warning)";
    }
    return style.color;
}

function paint(color: string, planned: boolean | undefined): CSSProperties {
    if (!planned) {
        return { background: color };
    }
    return {
        background: `color-mix(in oklab, ${color} 35%, transparent)`,
        border: `1px solid ${color}`,
    };
}

function paintBar(color: string, planned: boolean | undefined): CSSProperties {
    if (!planned) {
        return { background: color };
    }
    return {
        background: `color-mix(in oklab, ${color} 35%, transparent)`,
        boxShadow: `inset 0 0 0 1px ${color}`,
    };
}

const STATE_TEXT: Record<State, string> = {
    ok: "text-foreground",
    low: "text-warning",
    over: "text-destructive",
};

function used(segments: GaugeSegment[]): number {
    return segments.reduce((sum, segment) => sum + Math.max(0, segment.bytes), 0);
}

export function gaugeSummary(segments: GaugeSegment[], capacity: number): string {
    const total = used(segments);
    const parts = segments
        .filter((segment) => segment.bytes > 0)
        .map(
            (segment) =>
                `${segment.label}${segment.planned ? " (planned)" : ""} ${bytes(segment.bytes)}`,
        );
    const rest =
        total > capacity
            ? `${bytes(total - capacity)} more than the ${bytes(capacity)} there is`
            : `${bytes(capacity - total)} free of ${bytes(capacity)}`;
    return [...parts, rest].join(", ");
}

export function UsageGauge({
    label,
    capacity,
    segments,
    low = false,
    over = false,
    legend = true,
    free = true,
    basis,
    className,
}: {
    label: string;
    capacity: number;
    segments: GaugeSegment[];
    low?: boolean;
    over?: boolean;
    legend?: boolean;
    free?: boolean;
    basis?: GaugeBasis;
    className?: string;
}) {
    const total = used(segments);
    const state: State = over || total > capacity ? "over" : low ? "low" : "ok";
    const scale = Math.max(capacity, total);
    const anyPlanned = segments.some((segment) => segment.planned);
    const shown = segments.filter((segment) => segment.bytes > 0);
    return (
        <div className={cn("flex min-w-0 flex-col gap-2", className)}>
            <div className="flex flex-col gap-1">
                {free && (
                    <span
                        aria-hidden
                        className={cn(
                            "self-end text-sm font-medium tabular-nums",
                            STATE_TEXT[state],
                        )}
                    >
                        {`${capacity > 0 ? Math.round((total / capacity) * 100) : 0}% used`}
                    </span>
                )}
                <div
                    role="meter"
                    aria-label={basis ? `${label}, ${BASIS_LABELS[basis].toLowerCase()}` : label}
                    aria-valuemin={0}
                    aria-valuemax={Math.max(capacity, 1)}
                    aria-valuenow={Math.min(total, capacity)}
                    aria-valuetext={gaugeSummary(segments, capacity)}
                    className="relative h-5 w-full rounded-sm bg-secondary"
                >
                    <div className="flex h-full w-full overflow-hidden rounded-sm">
                        {shown.map((segment) => (
                            <Tooltip key={segment.key}>
                                <TooltipTrigger asChild>
                                    <span
                                        className="block h-full min-w-[3px] border-r border-card"
                                        style={{
                                            flex: `0 1 ${share(segment.bytes, scale)}%`,
                                            ...paintBar(
                                                colorOf(segment, state, anyPlanned),
                                                segment.planned,
                                            ),
                                        }}
                                    />
                                </TooltipTrigger>
                                <TooltipContent>
                                    <span className="tabular-nums">
                                        {`${segment.label}${segment.planned ? " (planned)" : ""} · ${bytes(segment.bytes)} · ${Math.round(share(segment.bytes, capacity))}%`}
                                    </span>
                                </TooltipContent>
                            </Tooltip>
                        ))}
                    </div>
                    {total > capacity && (
                        <span
                            aria-hidden
                            className="absolute -inset-y-1 w-0.5 bg-foreground"
                            style={{ left: `${share(capacity, scale)}%` }}
                        />
                    )}
                </div>
            </div>
            {legend && (
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                    <GaugeLegend
                        items={legendItems(segments, capacity, state, anyPlanned, free)}
                        short={total > capacity ? total - capacity : null}
                    />
                    {basis && <BasisLabel basis={basis} />}
                </div>
            )}
        </div>
    );
}

type LegendItem = { key: string; label: string; swatch: CSSProperties | null; value?: string };

function legendItems(
    segments: GaugeSegment[],
    capacity: number,
    state: State,
    anyPlanned: boolean,
    withFree: boolean,
): LegendItem[] {
    const groups = new Map<string, { segment: GaugeSegment; bytes: number }>();
    for (const segment of segments) {
        if (segment.bytes <= 0) {
            continue;
        }
        const name = segment.legend ?? GAUGE_KINDS[segment.kind].label;
        const key = `${name}-${segment.planned ? "planned" : "now"}`;
        const group = groups.get(key);
        groups.set(key, {
            segment: group?.segment ?? segment,
            bytes: (group?.bytes ?? 0) + segment.bytes,
        });
    }
    const items: LegendItem[] = [...groups.entries()].map(([key, { segment, bytes: value }]) => ({
        key,
        label: segment.legend ?? GAUGE_KINDS[segment.kind].label,
        swatch: paint(colorOf(segment, state, anyPlanned), segment.planned),
        value: bytes(value),
    }));
    const free = capacity - used(segments);
    if (withFree && free >= 0) {
        items.push({ key: "free", label: "Free", swatch: null, value: bytes(free) });
    }
    return items;
}

function GaugeLegend({
    items,
    short = null,
}: {
    items: LegendItem[];
    short?: number | null;
}) {
    return (
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
            {items.map((item) => (
                <li key={item.key} className="inline-flex min-w-0 items-center gap-1.5">
                    <span
                        aria-hidden
                        className={cn("size-2 shrink-0 rounded-xs", !item.swatch && FREE_SWATCH)}
                        style={item.swatch ?? undefined}
                    />
                    <span className="truncate">{item.label}</span>
                    {item.value && (
                        <span className="text-foreground tabular-nums">{item.value}</span>
                    )}
                </li>
            ))}
            {short !== null && (
                <li className="font-medium text-destructive tabular-nums">{`${bytes(short)} over`}</li>
            )}
        </ul>
    );
}
