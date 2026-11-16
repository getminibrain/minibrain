import type { ReactNode } from "react";
import { useMachineMetrics } from "~/api/machineQueries";
import type { components } from "~/api/schema";
import { Facts } from "~/components/Facts";
import { ErrorLine } from "~/components/Section";
import { type SparkPoint, Sparkline } from "~/components/Sparkline";
import { bytes, exactTime, relativeTime } from "~/lib/time";
import type { MachineRow } from "./machines";

type MetricsPoint = components["schemas"]["MetricsPoint"];
type NodeMetrics = components["schemas"]["NodeMetrics"];

const MAX_POINTS = 60;
const MINUTE = 60_000;
const SPARK_WIDTH = 240;
const SPARK_HEIGHT = 32;

function perMinute(points: MetricsPoint[]): MetricsPoint[] {
    const buckets = new Map<number, MetricsPoint>();
    for (const point of points) {
        buckets.set(Math.floor(Date.parse(point.at) / MINUTE), point);
    }
    return [...buckets.values()].slice(-MAX_POINTS);
}

function sparkPoints(
    points: MetricsPoint[],
    value: (point: MetricsPoint) => number | null | undefined,
): SparkPoint[] {
    return points.flatMap((point) => {
        const found = value(point);
        return found === null || found === undefined
            ? []
            : [{ key: point.at, label: exactTime(point.at), value: found }];
    });
}

function percentText(value: number): string {
    return `${Math.round(value)}%`;
}

function Trend({
    title,
    now,
    points,
    format,
}: {
    title: string;
    now: string;
    points: SparkPoint[];
    format: (value: number) => string;
}) {
    return (
        <div className="flex min-w-0 flex-col gap-1">
            <span className="flex items-baseline justify-between gap-3">
                <span className="text-sm text-muted-foreground">{title}</span>
                <span className="text-sm tabular-nums">{now}</span>
            </span>
            {points.length > 1 ? (
                <Sparkline
                    points={points}
                    width={SPARK_WIDTH}
                    height={SPARK_HEIGHT}
                    label={`${title} over the last hour`}
                    format={format}
                />
            ) : (
                <span className="text-sm text-muted-foreground">
                    The trend appears after a few heartbeats.
                </span>
            )}
        </div>
    );
}

function gpuFacts(current: NodeMetrics): [string, ReactNode][] {
    return current.gpus.map((gpu) => [
        current.gpus.length > 1 ? `GPU ${gpu.index}` : "GPU",
        <span key={String(gpu.index)} className="tabular-nums">
            {[
                gpu.memory_used_bytes !== null &&
                gpu.memory_used_bytes !== undefined &&
                gpu.memory_total_bytes
                    ? `${bytes(gpu.memory_used_bytes)} of ${bytes(gpu.memory_total_bytes)}`
                    : "Memory not reported",
                gpu.utilization !== null && gpu.utilization !== undefined
                    ? `${percentText(gpu.utilization)} busy`
                    : null,
            ]
                .filter(Boolean)
                .join(" · ")}
        </span>,
    ]);
}

function hostFacts(current: NodeMetrics): [string, ReactNode][] {
    return [
        [
            "RAM in use",
            <span key="ram" className="tabular-nums">
                {current.ram_used_bytes !== null &&
                current.ram_used_bytes !== undefined &&
                current.ram_total_bytes
                    ? `${bytes(current.ram_used_bytes)} of ${bytes(current.ram_total_bytes)}`
                    : "Not reported"}
            </span>,
        ],
        [
            "CPU busy",
            <span key="cpu" className="tabular-nums">
                {current.cpu_percent !== null && current.cpu_percent !== undefined
                    ? percentText(current.cpu_percent)
                    : "Not reported"}
            </span>,
        ],
        ["Sampled", relativeTime(current.at)],
    ];
}

export function LiveMetrics({ row }: { row: MachineRow }) {
    const { node, pool } = row;
    const metrics = useMachineMetrics(pool.name, node.host, node.online);
    if (!node.online) {
        return <p className="text-muted-foreground">No live metrics while offline.</p>;
    }
    const current = metrics.data?.current ?? node.metrics;
    if (!current) {
        return (
            <>
                <ErrorLine error={metrics.error} />
                <p className="text-muted-foreground">
                    This machine has not reported live metrics. Workers and engines of this version
                    send them with each heartbeat.
                </p>
            </>
        );
    }
    const history = perMinute(metrics.data?.history ?? []);
    const gpu = sparkPoints(history, (point) => point.gpu_percent);
    const memory = sparkPoints(history, (point) => point.memory_used_bytes);
    const total = current.memory_total_bytes;
    return (
        <div className="flex min-w-0 flex-col gap-4">
            <ErrorLine error={metrics.error} />
            <div className="grid gap-4 sm:grid-cols-2">
                <Trend
                    title="GPU busy"
                    now={
                        current.gpu_percent !== null && current.gpu_percent !== undefined
                            ? percentText(current.gpu_percent)
                            : "Not reported"
                    }
                    points={gpu}
                    format={percentText}
                />
                <Trend
                    title="Memory in use"
                    now={
                        current.memory_used_bytes !== null &&
                        current.memory_used_bytes !== undefined &&
                        total
                            ? `${bytes(current.memory_used_bytes)} of ${bytes(total)}`
                            : "Not reported"
                    }
                    points={memory}
                    format={(value) => bytes(value)}
                />
            </div>
            <Facts items={[...gpuFacts(current), ...hostFacts(current)]} />
        </div>
    );
}
