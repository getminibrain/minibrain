import { MemoryStick } from "lucide-react";
import { cn } from "obp-ui";
import type { ReactNode } from "react";
import { SummaryLine } from "~/components/CreateLayout";
import { PoolLink } from "~/components/PoolLink";
import { UsageGauge } from "~/components/UsageGauge";
import { count } from "~/lib/format";
import { type OptionInfo, duration, gigabytes } from "./recipe";

export function Row({
    id,
    label,
    children,
}: { id: string; label: ReactNode; children: ReactNode }) {
    return (
        <section
            aria-labelledby={id}
            className="grid gap-label py-4 sm:grid-cols-[6rem_minmax(0,1fr)] sm:gap-x-6"
        >
            <h3 id={id} className="text-base font-medium sm:leading-8">
                {label}
            </h3>
            <div className="flex min-w-0 flex-col gap-2">{children}</div>
        </section>
    );
}

export function Meta({ children, className }: { children: ReactNode; className?: string }) {
    return (
        <p className={cn("text-sm text-muted-foreground tabular-nums", className)}>{children}</p>
    );
}

export type PresetTime = number | null | undefined | "unplanned";

export function timeText(time: PresetTime): string {
    if (time === undefined) {
        return "Estimating…";
    }
    if (time === "unplanned") {
        return "planned by the worker";
    }
    return time === null ? "Does not fit" : `≈ ${duration(time)}`;
}

const SEGMENTS = [
    { key: "weights", kind: "weights", label: "Weights" },
    { key: "adapter", kind: "adapters", label: "Adapter" },
    { key: "activations", kind: "training", label: "Activations" },
] as const;

type Segment = (typeof SEGMENTS)[number]["key"];

function partsOf(option: OptionInfo): Record<Segment, number> {
    const parts = option.parts;
    return {
        weights: parts.weights ?? 0,
        adapter: parts.adapter ?? 0,
        activations: (parts.activations ?? 0) + (parts.logits ?? 0) + (parts.overhead ?? 0),
    };
}

function fits(option: OptionInfo): boolean {
    return option.fits;
}

export function fitText(option: OptionInfo | null | undefined): string {
    if (!option) {
        return "does not fit";
    }
    return `fits ${gigabytes(option.peak_bytes).replace(" GB", "")} of ${gigabytes(option.available_bytes)}`;
}

export const AUTO = "auto";

export function HeldOutWarning({ heldOut }: { heldOut: number }) {
    return (
        <div
            role="alert"
            className="rounded-md border border-warning/40 bg-warning-soft px-3 py-2.5"
        >
            <p className="tabular-nums">
                <span className="font-medium text-warning">{`Only ${count(heldOut)} held-out rows. `}</span>
                {`One row moves the score by ${Math.round(100 / Math.max(heldOut, 1))} points, so versions are hard to tell apart. Add rows to the dataset so its held-out split grows.`}
            </p>
        </div>
    );
}

export function MemorySummary({
    option,
    memoryLabel,
    pool,
}: {
    option: OptionInfo;
    memoryLabel: string;
    pool: string | null;
}) {
    const ok = fits(option);
    const parts = partsOf(option);
    const available = option.available_bytes ?? option.peak_bytes;
    return (
        <>
            <UsageGauge
                label={`${memoryLabel} for training`}
                capacity={available}
                over={!ok}
                segments={SEGMENTS.map((segment) => ({
                    key: segment.key,
                    kind: segment.kind,
                    label: segment.label,
                    legend: segment.label,
                    bytes: parts[segment.key],
                }))}
            />
            <SummaryLine
                icon={MemoryStick}
                className={cn("tabular-nums", !ok && "text-destructive")}
            >
                {ok
                    ? `${gigabytes(option.peak_bytes)} of ${gigabytes(available)} ${memoryLabel}`
                    : `${gigabytes(option.peak_bytes)} needed · only ${gigabytes(available)} ${memoryLabel}`}
                {pool && (
                    <>
                        {" in "}
                        <PoolLink name={pool} align="end" />
                    </>
                )}
            </SummaryLine>
        </>
    );
}

export function PaneHeader({
    id,
    title,
    action,
}: {
    id: string;
    title: string;
    action?: ReactNode;
}) {
    return (
        <div className="flex min-h-12 items-center justify-between gap-3 border-b">
            <h3 id={id} className="font-medium">
                {title}
            </h3>
            {action}
        </div>
    );
}
