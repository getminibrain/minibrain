import {
    IconAlertCircle,
    IconChartLine,
    IconHistory,
    IconKey,
    IconLogs,
    IconStopwatch,
} from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import {
    Badge,
    DataGrid,
    Link,
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
    cn,
} from "obp-ui";
import { type ReactNode, useState } from "react";
import { type ModelRow, type VersionInfo, api, unwrap } from "~/api/client";
import { useModelTraffic } from "~/api/modelPageQueries";
import { useModel, useModelPage } from "~/api/queries";
import { ErrorLine, PanelSection, PanelSections } from "~/components/Section";
import { LineChart } from "~/components/charts/LineChart";
import { StatusText } from "~/components/models/StatusText";
import { count } from "~/lib/format";
import {
    REQUEST_BODIES_ID,
    deploymentPageHref,
    modelVersionHref,
    requestLogHref,
} from "~/lib/modelLinks";
import { modelLabel } from "~/lib/requests";
import { exactTime } from "~/lib/time";
import {
    PERIOD,
    SPAN,
    type TrafficRange,
    type TrafficReport,
    type TrafficStats,
    errorLine,
    fineRate,
    gpu,
    gpuPerMillionTokens,
    ms,
    percentileLines,
    pointsChange,
    rate,
    readoutTitle,
    relativeChange,
    xFormat,
} from "~/lib/traffic";
import { RequestDialog } from "~/pages/monitor/RequestDetail";
import { REQUEST_COLUMNS } from "~/pages/monitor/RequestsTab";
import { isDeployed } from "./header";
import { RangeSwitch, TrafficCharts, useTrafficRange } from "./usage";

const RECENT_ROWS = 20;

function Figure({
    label,
    value,
    delta,
    alert = false,
}: {
    label: string;
    value: ReactNode;
    delta: string | null;
    alert?: boolean;
}) {
    return (
        <div className="flex min-w-0 flex-col gap-0.5">
            <dt className="text-sm text-muted-foreground">{label}</dt>
            <dd
                className={cn(
                    "text-xl tabular-nums",
                    alert ? "text-destructive" : "text-foreground",
                )}
            >
                {value}
            </dd>
            <dd className="text-sm text-muted-foreground tabular-nums">{delta ?? " "}</dd>
        </div>
    );
}

function fullPeriod(
    report: TrafficReport | undefined,
    createdAt: string | null | undefined,
): boolean {
    if (!report || !createdAt) {
        return true;
    }
    const span = Date.parse(report.until) - Date.parse(report.since);
    return Date.parse(createdAt) <= Date.parse(report.since) - span;
}

const NO_TRAFFIC: TrafficStats = {
    requests: 0,
    errors: 0,
    error_rate: null,
    p50_ms: null,
    p95_ms: null,
    p99_ms: null,
    device_seconds: 0,
    tokens: 0,
};

function SummaryStrip({ report, full }: { report: TrafficReport | undefined; full: boolean }) {
    const now = report?.totals ?? NO_TRAFFIC;
    const before = report?.previous;
    const empty = now.requests === 0;
    const compare =
        full && before !== null && before !== undefined && before.requests > 0 && !empty;
    const none = empty
        ? null
        : !full
          ? "No full earlier period"
          : before
            ? "No earlier traffic"
            : "No earlier period";
    const usual = report?.usual_error_rate;
    const change = (pick: (stats: TrafficStats) => number | null) =>
        compare && before ? relativeChange(pick(now), pick(before)) : none;
    return (
        <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3 lg:grid-cols-5">
            <Figure
                label="Requests"
                value={count(now.requests)}
                delta={change((stats) => stats.requests)}
            />
            <Figure
                label="Latency p95"
                value={empty ? "–" : ms(now.p95_ms)}
                delta={change((stats) => stats.p95_ms ?? null)}
            />
            <Figure
                label="Latency p99"
                value={empty ? "–" : ms(now.p99_ms)}
                delta={change((stats) => stats.p99_ms ?? null)}
            />
            <Figure
                label="Error rate"
                value={empty ? "–" : rate(now.error_rate ?? 0)}
                alert={
                    usual !== null &&
                    usual !== undefined &&
                    (now.error_rate ?? 0) > Math.max(usual * 3, 0.02)
                }
                delta={
                    compare && before
                        ? pointsChange(now.error_rate ?? 0, before.error_rate ?? 0)
                        : none
                }
            />
            <Figure
                label="Cost / 1M tokens"
                value={empty ? "–" : gpu(gpuPerMillionTokens(now))}
                delta={change(gpuPerMillionTokens)}
            />
        </dl>
    );
}

function LatencySection({
    row,
    report,
    range,
}: { row: ModelRow; report: TrafficReport; range: TrafficRange }) {
    const lines = percentileLines(report);
    return (
        <PanelSection icon={IconStopwatch} title="Latency">
            <LineChart
                rows={lines.rows}
                series={lines.series}
                legendSeries={lines.legend}
                format={ms}
                label={`Latency percentiles for ${row.name} ${SPAN[range]}`}
                height={220}
                xFormat={xFormat(range)}
                readoutTitle={readoutTitle(report)}
            />
        </PanelSection>
    );
}

function statusClass(status: number): string {
    return status >= 500 ? "server_error" : "client_error";
}

function lastSeen(at: string): string {
    const minutes = Math.max(0, Math.round((Date.now() - Date.parse(at)) / 60000));
    if (minutes < 60) {
        return `${minutes} min ago`;
    }
    if (minutes < 48 * 60) {
        return `${Math.floor(minutes / 60)} h ago`;
    }
    return `${Math.floor(minutes / (24 * 60))} d ago`;
}

function ErrorsSection({
    row,
    report,
    range,
}: { row: ModelRow; report: TrafficReport; range: TrafficRange }) {
    const line = errorLine(report);
    const usual = report.usual_error_rate;
    return (
        <PanelSection icon={IconAlertCircle} title="Errors" flush>
            <div className="p-panel">
                <LineChart
                    rows={line.rows}
                    series={line.series}
                    format={fineRate}
                    label={`Error rate for ${row.name} ${SPAN[range]}`}
                    levels={
                        usual === null || usual === undefined
                            ? []
                            : [{ at: usual, label: `Usually ${rate(usual)}` }]
                    }
                    legend={false}
                    height={160}
                    xFormat={xFormat(range)}
                    readoutTitle={readoutTitle(report)}
                />
            </div>
            {report.errors.length === 0 ? (
                <p className="border-t px-panel py-4 text-muted-foreground">{`No failed requests ${SPAN[range]}.`}</p>
            ) : (
                <Table className="border-t">
                    <TableHeader>
                        <TableRow>
                            <TableHead className="pl-panel">Type</TableHead>
                            <TableHead className="text-right">Requests</TableHead>
                            <TableHead className="text-right">Last seen</TableHead>
                            <TableHead className="pr-panel text-right">
                                <span className="sr-only">Log</span>
                            </TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {report.errors.map((item) => (
                            <TableRow key={item.status}>
                                <TableCell className="pl-panel">
                                    <StatusText tone="destructive">{item.label}</StatusText>
                                </TableCell>
                                <TableCell className="text-right">{count(item.requests)}</TableCell>
                                <TableCell className="text-right text-muted-foreground">
                                    {lastSeen(item.last_at)}
                                </TableCell>
                                <TableCell className="pr-panel text-right">
                                    <Link
                                        href={requestLogHref({
                                            model: row.key,
                                            status: statusClass(item.status),
                                            range,
                                        })}
                                        className="text-primary hover:underline"
                                    >
                                        In the log →
                                    </Link>
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            )}
        </PanelSection>
    );
}

function VersionsSection({ row, report }: { row: ModelRow; report: TrafficReport }) {
    const total = report.versions.reduce((sum, item) => sum + item.requests, 0);
    const usual = report.usual_error_rate ?? null;
    return (
        <PanelSection
            icon={IconHistory}
            title="By version"
            tip={`Calls to ${row.key}@N reach that version whether it is deployed or not.`}
            flush
        >
            <Table>
                <TableHeader>
                    <TableRow>
                        <TableHead className="pl-panel">Version</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="text-right">Requests</TableHead>
                        <TableHead className="text-right">Share</TableHead>
                        <TableHead className="text-right">Latency p95</TableHead>
                        <TableHead className="text-right">Error rate</TableHead>
                        <TableHead className="pr-panel text-right">Cost</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {report.versions.map((item) => (
                        <TableRow key={item.version ?? "base"}>
                            <TableCell className="pl-panel">
                                {item.version === null || item.version === undefined ? (
                                    <span>Base weights</span>
                                ) : (
                                    <Link
                                        href={modelVersionHref(row.key, item.version)}
                                        className="font-medium tabular-nums hover:underline"
                                    >
                                        {`v${item.version}`}
                                    </Link>
                                )}
                            </TableCell>
                            <TableCell>
                                {item.live ? (
                                    <Badge variant="success">Live</Badge>
                                ) : (
                                    <Badge variant="neutral">Pinned or earlier</Badge>
                                )}
                            </TableCell>
                            <TableCell className="text-right">{count(item.requests)}</TableCell>
                            <TableCell className="text-right">
                                {total > 0 ? `${((item.requests * 100) / total).toFixed(1)}%` : "–"}
                            </TableCell>
                            <TableCell className="text-right">{ms(item.p95_ms)}</TableCell>
                            <TableCell
                                className={cn(
                                    "text-right",
                                    usual !== null &&
                                        (item.error_rate ?? 0) > Math.max(usual * 3, 0.02) &&
                                        "text-destructive",
                                )}
                            >
                                {rate(item.error_rate ?? 0)}
                            </TableCell>
                            <TableCell className="pr-panel text-right">
                                {gpu(item.device_seconds)}
                            </TableCell>
                        </TableRow>
                    ))}
                </TableBody>
            </Table>
        </PanelSection>
    );
}

function CallersSection({
    row,
    report,
    range,
}: { row: ModelRow; report: TrafficReport; range: TrafficRange }) {
    const total = report.callers.reduce((sum, item) => sum + item.requests, 0);
    return (
        <PanelSection icon={IconKey} title="Callers" flush>
            {report.callers.length === 0 ? (
                <p className="p-panel text-muted-foreground">{`No requests ${SPAN[range]}.`}</p>
            ) : (
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead className="pl-panel">Key</TableHead>
                            <TableHead>Prefix</TableHead>
                            <TableHead className="text-right">Requests</TableHead>
                            <TableHead className="text-right">Share</TableHead>
                            <TableHead className="pr-panel text-right">Error rate</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {report.callers.map((item) => (
                            <TableRow key={item.key_id ?? "none"}>
                                <TableCell className="pl-panel">
                                    {item.key_id ? (
                                        <Link
                                            href={requestLogHref({
                                                model: row.key,
                                                key: String(item.key_id),
                                                range,
                                            })}
                                            className="hover:underline"
                                        >
                                            {item.name ?? `Key ${item.key_id}`}
                                        </Link>
                                    ) : (
                                        <span className="text-muted-foreground">
                                            {item.revoked ? "Revoked key" : "No key"}
                                        </span>
                                    )}
                                </TableCell>
                                <TableCell className="font-mono text-sm text-muted-foreground">
                                    {item.prefix ? `${item.prefix}…` : "–"}
                                </TableCell>
                                <TableCell className="text-right">{count(item.requests)}</TableCell>
                                <TableCell className="text-right">
                                    {total > 0
                                        ? `${Math.round((item.requests * 100) / total)}%`
                                        : "–"}
                                </TableCell>
                                <TableCell className="pr-panel text-right">
                                    {rate(item.error_rate ?? 0)}
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            )}
        </PanelSection>
    );
}

function useLatestRequests(slug: string) {
    return useQuery({
        queryKey: ["requests", "latest", slug, RECENT_ROWS],
        queryFn: () =>
            unwrap(
                api.GET("/api/requests", {
                    params: { query: { model: [slug], limit: RECENT_ROWS } },
                }),
            ),
        refetchInterval: 10000,
    });
}

function RecentRequests({ row }: { row: ModelRow }) {
    const latest = useLatestRequests(row.key);
    const items = latest.data?.items ?? [];
    const detail = useModel(row.kind === "custom" ? row.key : "");
    const kept = detail.data?.request_bodies.kept ?? true;
    const [open, setOpen] = useState<number | null>(null);
    return (
        <PanelSection
            icon={IconLogs}
            title="Recent requests"
            tip="Prompts and answers stay on this install."
            description={
                kept ? (
                    `The last ${RECENT_ROWS} requests to this model.`
                ) : (
                    <>
                        {"Inputs and answers are not kept · "}
                        <Link
                            href={`${deploymentPageHref(row.key)}#${REQUEST_BODIES_ID}`}
                            className="text-primary hover:underline"
                        >
                            Change in Settings
                        </Link>
                    </>
                )
            }
            actions={
                <Link
                    href={requestLogHref({ model: row.key })}
                    className="text-sm text-primary hover:underline"
                >
                    All requests
                </Link>
            }
            bare
        >
            <ErrorLine error={latest.error} onRetry={latest.refetch} />
            <DataGrid
                columns={REQUEST_COLUMNS}
                rows={items}
                getRowId={(item) => String(item.id)}
                loading={latest.isLoading}
                sortable={false}
                storageKey="minibrain.model-requests.columns"
                columnPicker
                hiddenColumns={["kind", "finish", "response"]}
                onOpen={(item) => setOpen(item.id)}
                rowLabel={(item) =>
                    `Request ${item.id}, ${modelLabel(item)}, status ${item.status}, ${exactTime(item.at)}`
                }
                empty={<p className="text-muted-foreground">No requests yet.</p>}
                maxHeight="24rem"
                className="h-96"
            />
            <RequestDialog
                id={open}
                loaded={items.find((item) => item.id === open)}
                onClose={() => setOpen(null)}
            />
        </PanelSection>
    );
}

function emptyText(row: ModelRow, range: TrafficRange): string {
    if (!isDeployed(row) || (row.kind === "custom" && row.current_version === null)) {
        return "Not deployed yet. Deploy it, then connect an app with an API key.";
    }
    return `No requests ${SPAN[range]}. Connect an app with an API key to see traffic here.`;
}

export function MonitoringTab({ row, versions }: { row: ModelRow; versions: VersionInfo[] }) {
    const [range, setRange] = useTrafficRange();
    const traffic = useModelTraffic(row.key, range);
    const page = useModelPage(row.key);
    const report = traffic.data;
    const empty = !report || report.totals.requests === 0;
    return (
        <div className="flex flex-col gap-4 pt-4">
            <ErrorLine error={traffic.error} onRetry={traffic.refetch} />
            <PanelSections>
                <PanelSection
                    icon={IconChartLine}
                    title="Traffic"
                    tip={`Changes compare with ${PERIOD[range]}.`}
                    actions={
                        <>
                            <Link
                                href={`/monitor?model=${encodeURIComponent(row.key)}`}
                                className="text-sm text-primary hover:underline"
                            >
                                All models in Monitoring
                            </Link>
                            <RangeSwitch range={range} onRange={setRange} />
                        </>
                    }
                >
                    <div className="flex flex-col gap-6">
                        <SummaryStrip
                            report={report}
                            full={fullPeriod(report, page.data?.created_at)}
                        />
                        <TrafficCharts
                            row={row}
                            versions={versions}
                            report={report}
                            range={range}
                            emptyHint={emptyText(row, range)}
                        />
                    </div>
                </PanelSection>
                <RecentRequests row={row} />
                {report && !empty && (
                    <>
                        <LatencySection row={row} report={report} range={range} />
                        <ErrorsSection row={row} report={report} range={range} />
                        {row.kind === "custom" && <VersionsSection row={row} report={report} />}
                        <CallersSection row={row} report={report} range={range} />
                    </>
                )}
            </PanelSections>
        </div>
    );
}
