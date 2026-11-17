import { InfoTip, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, cn } from "obp-ui";
import type { VersionInfo } from "~/api/client";
import { costSortValue, costText } from "~/lib/cost";
import { count, milliseconds, percent } from "~/lib/format";
import { metricName, metricOf } from "~/lib/metrics";
import {
    type Peers,
    type Phase,
    UNSCORED,
    noiseBand,
    pts,
    referenceOf,
    scored,
    withinNoise,
} from "./versionState";

type Better = "higher" | "lower";

export type Measure = {
    id: string;
    label: string;
    value: (version: VersionInfo) => number | null;
    text: (version: VersionInfo) => string;
    change: (delta: number, base: number) => string;
    better: Better;
};

const ROW_HEIGHT = 36;
const HEAD_HEIGHT = 32;
const NOT_MEASURED_HEIGHT = 36;

function signed(value: number, unit: string): string {
    const rounded = Math.round(value);
    if (rounded === 0) {
        return `±0${unit}`;
    }
    return `${rounded > 0 ? "+" : "−"}${Math.abs(rounded).toLocaleString()}${unit}`;
}

function share(pick: (item: VersionInfo) => number | null) {
    return {
        value: pick,
        text: (item: VersionInfo) => percent(pick(item)),
        change: (delta: number) => pts(delta).replace(" pts", ""),
    };
}

function latency(key: "latency_p50_ms" | "latency_p95_ms", label: string): Measure {
    return {
        id: key,
        label,
        better: "lower",
        value: (item) => item[key],
        text: (item) => milliseconds(item[key]),
        change: (delta) => signed(delta, " ms"),
    };
}

const COST: Measure = {
    id: "cost",
    label: "Cost / 1M tokens",
    better: "lower",
    value: (item) => (item.cost ? costSortValue(item.cost) : null),
    text: (item) => costText(item.cost),
    change: (delta, base) => (base > 0 ? signed((delta / base) * 100, "%") : "–"),
};

export function mainMeasure(version: VersionInfo): Measure {
    const metric = version.main_metric;
    return {
        id: "main",
        label: metricName(metric),
        better: "higher",
        ...share((item) => metricOf(item.held_out, metric) ?? item.score),
    };
}

export const INVALID: Measure = {
    id: "invalid",
    label: "Invalid answers",
    better: "lower",
    ...share((item) => item.held_out?.invalid_rate ?? null),
};

export const P95 = latency("latency_p95_ms", "p95 latency");

export function costMeasure(versions: VersionInfo[]): Measure | null {
    return versions.some((item) => item.cost) ? COST : null;
}

export function measures(version: VersionInfo, versions: VersionInfo[]): Measure[] {
    const list: Measure[] = [mainMeasure(version)];
    if (version.main_metric === "label_accuracy") {
        list.push({
            id: "macro_f1",
            label: metricName("macro_f1"),
            better: "higher",
            ...share((item) => metricOf(item.held_out, "macro_f1")),
        });
    }
    list.push(INVALID, latency("latency_p50_ms", "p50 latency"), P95);
    const cost = costMeasure(versions);
    return cost ? [...list, cost] : list;
}

export function changeTone(delta: number, text: string, better: Better): string {
    if (text.startsWith("±") || text === "–") {
        return "text-muted-foreground";
    }
    const good = better === "higher" ? delta > 0 : delta < 0;
    return good ? "text-success" : "text-destructive";
}

export function changeOf(
    measure: Measure,
    mine: VersionInfo,
    theirs: VersionInfo | undefined,
): { delta: number; text: string } | null {
    const a = scored(mine) ? measure.value(mine) : null;
    const b = theirs && scored(theirs) ? measure.value(theirs) : null;
    if (a === null || b === null) {
        return null;
    }
    return { delta: a - b, text: measure.change(a - b, b) };
}

export function pendingText(phase: Phase): string {
    if (phase === "queued" || phase === "training") {
        return "after training";
    }
    return phase === "scoring" ? "Scoring…" : "–";
}

function shownValue(measure: Measure, version: VersionInfo | undefined): number | null {
    return version && scored(version) ? measure.value(version) : null;
}

function Theirs({
    measure,
    mine,
    theirs,
}: { measure: Measure; mine: VersionInfo; theirs: VersionInfo }) {
    if (shownValue(measure, theirs) === null) {
        return <span className="text-muted-foreground">–</span>;
    }
    const change = changeOf(measure, mine, theirs);
    return (
        <span className="flex items-baseline gap-2">
            <span>{measure.text(theirs)}</span>
            {change && (
                <span
                    className={cn("text-sm", changeTone(change.delta, change.text, measure.better))}
                >
                    {change.text}
                </span>
            )}
        </span>
    );
}

export function scoreTableHeight(rows: number): number {
    return HEAD_HEIGHT + rows * ROW_HEIGHT + NOT_MEASURED_HEIGHT;
}

export function ScoreTable({
    version,
    versions,
    phase,
    peers,
}: {
    version: VersionInfo;
    versions: VersionInfo[];
    phase: Phase;
    peers: Peers;
}) {
    const all = measures(version, versions);
    const columns = [peers.live, peers.zero].filter((item): item is VersionInfo => Boolean(item));
    const columnName = (item: VersionInfo) =>
        item === peers.live ? `live v${item.number}` : `baseline v${item.number}`;
    const measured = all.filter((measure) =>
        [version, ...columns].some((item) => shownValue(measure, item) !== null),
    );
    const missing = all.filter((measure) => !measured.includes(measure));
    const mineName = peers.isLive ? `v${version.number} · live` : `v${version.number}`;
    return (
        <div className="flex flex-col" style={{ minHeight: scoreTableHeight(all.length) }}>
            {measured.length === 0 ? (
                <p className="flex flex-1 items-center justify-center px-panel text-muted-foreground">
                    {UNSCORED.includes(phase)
                        ? `Scores show once v${version.number} is scored.`
                        : "Nothing is scored yet."}
                </p>
            ) : (
                <>
                    <Table aria-label={`Scores of v${version.number}`} className="table-fixed">
                        <TableHeader>
                            <TableRow className="hover:bg-transparent">
                                <TableHead className="w-48 pl-panel">Measure</TableHead>
                                <TableHead className="w-36">{mineName}</TableHead>
                                {columns.map((item) => (
                                    <TableHead key={item.number} className="w-44">
                                        {columnName(item)}
                                    </TableHead>
                                ))}
                                <TableHead>
                                    <span className="sr-only">Space</span>
                                </TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {measured.map((measure) => (
                                <TableRow key={measure.id} className="h-9 hover:bg-transparent">
                                    <TableCell className="pl-panel text-muted-foreground">
                                        {measure.label}
                                    </TableCell>
                                    <TableCell className="font-medium">
                                        {phase === "ready" ? (
                                            measure.text(version)
                                        ) : (
                                            <span className="font-normal text-muted-foreground">
                                                {pendingText(phase)}
                                            </span>
                                        )}
                                    </TableCell>
                                    {columns.map((item) => (
                                        <TableCell key={item.number}>
                                            <Theirs
                                                measure={measure}
                                                mine={version}
                                                theirs={item}
                                            />
                                        </TableCell>
                                    ))}
                                    <TableCell />
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                    <p className="flex h-9 items-center truncate px-panel text-sm text-muted-foreground">
                        {missing.length > 0
                            ? `Not measured: ${missing.map((measure) => measure.label).join(", ")}`
                            : ""}
                    </p>
                </>
            )}
        </div>
    );
}

export function NoiseNote({
    version,
    phase,
    peers,
}: {
    version: VersionInfo;
    phase: Phase;
    peers: Peers;
}) {
    const reference = referenceOf(peers);
    const rows = version.held_out?.examples ?? 0;
    if (phase !== "ready" || version.score === null || !reference) {
        const text = UNSCORED.includes(phase)
            ? `Noise check once v${version.number} is scored`
            : phase === "ready"
              ? "Nothing to check against: no other scored version"
              : "No scores, so no noise check";
        return <p className="truncate text-sm text-muted-foreground">{text}</p>;
    }
    const theirs = reference.version.score ?? 0;
    const delta = version.score - theirs;
    const within = withinNoise(version.score, theirs, rows);
    return (
        <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <span className="truncate tabular-nums">
                {`${pts(delta)} vs ${reference.label} is ${within ? "within" : "beyond"} noise on ${count(rows)} rows`}
            </span>
            <InfoTip label="About the noise check" side="right">
                {`An approximation: a change counts as noise when it is smaller than twice the binomial standard error of the difference, here ${pts(noiseBand(version.score, theirs, rows)).replace(/^\+/, "±")}. It treats both scores as independent samples of ${count(rows)} rows, which overstates the noise a little since both versions answered the same rows.`}
            </InfoTip>
        </p>
    );
}
