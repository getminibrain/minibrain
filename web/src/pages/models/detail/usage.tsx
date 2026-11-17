import { IconChartLine } from "@tabler/icons-react";
import { Link, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "obp-ui";
import { useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import type { ModelRow, VersionInfo } from "~/api/client";
import { useModelTraffic } from "~/api/modelPageQueries";
import { PoolPlaces } from "~/components/PoolLink";
import { ErrorLine, PanelSection } from "~/components/Section";
import { type SparkPoint, Sparkline } from "~/components/Sparkline";
import { LineChart } from "~/components/charts/LineChart";
import { ChartLegend } from "~/components/charts/TimeChart";
import { count } from "~/lib/format";
import { modelPageHref } from "~/lib/modelLinks";
import {
    EMPTY_DOMAIN,
    LAST,
    METRICS,
    RANGES,
    SPAN,
    type TrafficMetric,
    type TrafficRange,
    type TrafficReport,
    axisFormatOf,
    bucketEnd,
    formatOf,
    markersOf,
    metricText,
    metricValue,
    readoutNotes,
    readoutTitle,
    usageOf,
    versionColors,
    xFormat,
    zeroUsage,
} from "~/lib/traffic";
import { isDeployed } from "./header";

let sharedRange: TrafficRange = "24h";
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

export function useTrafficRange(): [TrafficRange, (range: TrafficRange) => void] {
    const range = useSyncExternalStore(subscribe, () => sharedRange);
    return [
        range,
        (next) => {
            sharedRange = next;
            for (const listener of listeners) {
                listener();
            }
        },
    ];
}

function Choice<T extends string>({
    label,
    options,
    value,
    onValue,
}: {
    label: string;
    options: { key: T; label: string }[];
    value: T;
    onValue: (value: T) => void;
}) {
    return (
        <Select value={value} onValueChange={(next) => next && onValue(next as T)}>
            <SelectTrigger aria-label={label}>
                <SelectValue />
            </SelectTrigger>
            <SelectContent align="end">
                {options.map((option) => (
                    <SelectItem key={option.key} value={option.key}>
                        {option.label}
                    </SelectItem>
                ))}
            </SelectContent>
        </Select>
    );
}

export function RangeSwitch({
    range,
    onRange,
}: {
    range: TrafficRange;
    onRange: (range: TrafficRange) => void;
}) {
    return <Choice label="Time range" options={RANGES} value={range} onValue={onRange} />;
}

function MetricChart({
    row,
    report,
    range,
    metric,
    colors,
    height,
}: {
    row: ModelRow;
    report: TrafficReport | undefined;
    range: TrafficRange;
    metric: TrafficMetric;
    colors: Map<number, string>;
    height: number;
}) {
    const custom = row.kind === "custom";
    const label = METRICS.find((item) => item.key === metric)?.label ?? "";
    const empty = !report || report.totals.requests === 0;
    const usage =
        report && !empty
            ? usageOf(report, metric, colors, custom, row.name)
            : zeroUsage(report, range, label);
    return (
        <div className="flex min-w-0 flex-col gap-2">
            <p className="flex items-baseline justify-between gap-3">
                <span className="text-muted-foreground">{label}</span>
                <span className="tabular-nums">
                    {report ? metricText(metric, report.totals) : "–"}
                </span>
            </p>
            <LineChart
                rows={usage.rows}
                series={usage.series}
                format={formatOf(metric)}
                axisFormat={axisFormatOf(metric, report)}
                integer={metric === "requests"}
                label={`${label} for ${row.name} ${SPAN[range]}${custom ? ", by version" : ""}`}
                height={height}
                markers={report && !empty ? markersOf(report) : []}
                yDomain={empty ? EMPTY_DOMAIN[metric] : undefined}
                xFormat={xFormat(range)}
                readoutTitle={report ? readoutTitle(report) : undefined}
                readoutNotes={report && !empty ? readoutNotes(report) : undefined}
                legend={false}
            />
        </div>
    );
}

function VersionLegend({
    row,
    report,
    colors,
}: {
    row: ModelRow;
    report: TrafficReport | undefined;
    colors: Map<number, string>;
}) {
    if (!report || report.totals.requests === 0 || row.kind !== "custom") {
        return null;
    }
    const usage = usageOf(report, "requests", colors, true, row.name);
    return <ChartLegend series={usage.legend} />;
}

export function TrafficCharts({
    row,
    versions,
    report,
    range,
    emptyHint,
}: {
    row: ModelRow;
    versions: VersionInfo[];
    report: TrafficReport | undefined;
    range: TrafficRange;
    emptyHint: string;
}) {
    const colors = versionColors(versions);
    const empty = !report || report.totals.requests === 0;
    return (
        <div className="flex min-w-0 flex-col gap-4">
            <div className="flex h-5 min-w-0 items-center">
                {empty ? (
                    <p className="truncate text-muted-foreground">{emptyHint}</p>
                ) : (
                    <VersionLegend row={row} report={report} colors={colors} />
                )}
            </div>
            <div className="grid grid-cols-2 gap-x-8 gap-y-6">
                {METRICS.map((item) => (
                    <MetricChart
                        key={item.key}
                        row={row}
                        report={report}
                        range={range}
                        metric={item.key}
                        colors={colors}
                        height={160}
                    />
                ))}
            </div>
        </div>
    );
}

function sparkValue(
    bucket: TrafficReport["buckets"][number],
    metric: TrafficMetric,
): number | null {
    if (metric === "requests") {
        return bucket.requests;
    }
    if (bucket.requests === 0) {
        return metric === "errors" ? 0 : null;
    }
    return metricValue(bucket, metric);
}

function sparkPoints(report: TrafficReport | undefined, metric: TrafficMetric): SparkPoint[] {
    const buckets = report?.buckets ?? [];
    const title = report ? readoutTitle(report) : () => "";
    const found = buckets.flatMap((bucket, index) => {
        const value = sparkValue(bucket, metric);
        const end = report ? bucketEnd(report, index) : 0;
        return value === null ? [] : [{ key: bucket.at, label: title(end), value }];
    });
    return found.length > 1
        ? found
        : [
              { key: "start", label: "", value: 0 },
              { key: "end", label: "", value: 0 },
          ];
}

const FLAT: [number, number] = [0, 1];

function useWidth<T extends HTMLElement>() {
    const ref = useRef<T>(null);
    const [width, setWidth] = useState(0);
    useLayoutEffect(() => {
        const element = ref.current;
        if (!element) {
            return;
        }
        const observer = new ResizeObserver(([entry]) =>
            setWidth(Math.floor(entry.contentRect.width)),
        );
        observer.observe(element);
        return () => observer.disconnect();
    }, []);
    return [ref, width] as const;
}

function StripCell({
    metric,
    report,
}: {
    metric: TrafficMetric;
    report: TrafficReport | undefined;
}) {
    const [ref, width] = useWidth<HTMLDivElement>();
    const label = METRICS.find((item) => item.key === metric)?.label ?? "";
    const points = sparkPoints(report, metric);
    const flat = points.every((point) => point.value === points[0].value);
    return (
        <div className="flex min-w-0 flex-1 flex-col gap-1 px-4 py-3">
            <span className="truncate text-sm text-muted-foreground">{label}</span>
            <span className="truncate text-lg tabular-nums">
                {report ? metricText(metric, report.totals) : "–"}
            </span>
            <div ref={ref} className="h-6">
                {width > 0 && (
                    <Sparkline
                        points={points}
                        width={width}
                        height={24}
                        label={label}
                        format={formatOf(metric)}
                        domain={flat ? FLAT : undefined}
                    />
                )}
            </div>
        </div>
    );
}

function Footer({ row, report }: { row: ModelRow; report: TrafficReport | undefined }) {
    const replicas = report?.replicas ?? [];
    const quiet = !report || report.totals.requests === 0;
    if (quiet && !isDeployed(row)) {
        return "Not deployed yet · deploy it to start receiving requests";
    }
    return (
        <>
            {`${quiet ? "No traffic" : `${count(report.totals.tokens)} tokens`} · ${replicas.length} ${replicas.length === 1 ? "replica" : "replicas"}`}
            {replicas.length > 0 && (
                <>
                    {" in "}
                    <PoolPlaces places={replicas} machines={false} />
                </>
            )}
        </>
    );
}

export function UsagePanel({ row }: { row: ModelRow }) {
    const [range, setRange] = useTrafficRange();
    const traffic = useModelTraffic(row.key, range);
    const report = traffic.data;
    return (
        <PanelSection
            icon={IconChartLine}
            title="Usage"
            description={`${LAST[range]}${row.kind === "base" ? "." : ", all versions."}`}
            actions={
                <>
                    <RangeSwitch range={range} onRange={setRange} />
                    <Link
                        href={modelPageHref(row.key, "monitoring")}
                        className="text-sm text-primary hover:underline"
                    >
                        Open Monitoring
                    </Link>
                </>
            }
            flush
        >
            <div className="flex divide-x">
                {METRICS.map((item) => (
                    <StripCell key={item.key} metric={item.key} report={report} />
                ))}
            </div>
            <div className="flex h-9 items-center gap-3 border-t px-4 text-sm text-muted-foreground tabular-nums">
                {traffic.error ? (
                    <ErrorLine error={traffic.error} onRetry={traffic.refetch} />
                ) : (
                    <span className="min-w-0 truncate">
                        <Footer row={row} report={report} />
                    </span>
                )}
            </div>
        </PanelSection>
    );
}
