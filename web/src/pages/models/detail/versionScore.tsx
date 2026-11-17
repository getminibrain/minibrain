import { IconGauge } from "@tabler/icons-react";
import { InfoTip, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, cn } from "obp-ui";
import type { VersionInfo } from "~/api/client";
import { PanelSection } from "~/components/Section";
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

type Measure = {
    id: string;
    label: string;
    value: (version: VersionInfo) => number | null;
    text: (version: VersionInfo) => string;
    change: (delta: number, base: number) => string;
    better: Better;
};

function signed(value: number, unit: string): string {
    const rounded = Math.round(value);
    if (rounded === 0) {
        return `±0${unit}`;
    }
    return `${rounded > 0 ? "+" : "−"}${Math.abs(rounded).toLocaleString()}${unit}`;
}

function measures(version: VersionInfo, versions: VersionInfo[]): Measure[] {
    const metric = version.main_metric;
    const share = (pick: (item: VersionInfo) => number | null) => ({
        value: pick,
        text: (item: VersionInfo) => percent(pick(item)),
        change: (delta: number) => pts(delta),
    });
    const list: Measure[] = [
        {
            id: "main",
            label: metricName(metric),
            better: "higher",
            ...share((item) => metricOf(item.held_out, metric) ?? item.score),
        },
    ];
    if (metric === "label_accuracy") {
        list.push({
            id: "macro_f1",
            label: metricName("macro_f1"),
            better: "higher",
            ...share((item) => metricOf(item.held_out, "macro_f1")),
        });
    }
    list.push({
        id: "invalid",
        label: "Invalid answers",
        better: "lower",
        ...share((item) => item.held_out?.invalid_rate ?? null),
    });
    for (const [key, label] of [
        ["latency_p50_ms", "Latency p50"],
        ["latency_p95_ms", "Latency p95"],
    ] as const) {
        list.push({
            id: key,
            label,
            better: "lower",
            value: (item) => item[key],
            text: (item) => milliseconds(item[key]),
            change: (delta) => signed(delta, " ms"),
        });
    }
    if (versions.some((item) => item.cost)) {
        list.push({
            id: "cost",
            label: "Cost per 1k requests",
            better: "lower",
            value: (item) => (item.cost ? costSortValue(item.cost) : null),
            text: (item) => costText(item.cost),
            change: (delta, base) => (base > 0 ? signed((delta / base) * 100, "%") : "–"),
        });
    }
    return list;
}

function tone(delta: number, text: string, better: Better): string {
    if (text.startsWith("±") || text === "–") {
        return "text-muted-foreground";
    }
    const good = better === "higher" ? delta > 0 : delta < 0;
    return good ? "text-success" : "text-destructive";
}

function Change({
    measure,
    mine,
    theirs,
    label,
}: {
    measure: Measure;
    mine: VersionInfo;
    theirs: VersionInfo | undefined;
    label: string;
}) {
    const a = measure.value(mine);
    const b = theirs && scored(theirs) ? measure.value(theirs) : null;
    if (a === null || b === null) {
        return null;
    }
    const delta = a - b;
    const text = measure.change(delta, b);
    return (
        <span className="text-sm whitespace-nowrap">
            <span className={cn("tabular-nums", tone(delta, text, measure.better))}>{text}</span>
            <span className="text-muted-foreground">{` vs ${label}`}</span>
        </span>
    );
}

function pending(phase: Phase): string {
    if (phase === "queued" || phase === "training") {
        return "after training";
    }
    return phase === "scoring" ? "Scoring…" : "–";
}

function MineCell({
    measure,
    version,
    phase,
    peers,
}: {
    measure: Measure;
    version: VersionInfo;
    phase: Phase;
    peers: Peers;
}) {
    if (phase !== "ready") {
        return <span className="text-muted-foreground">{pending(phase)}</span>;
    }
    return (
        <span className="flex items-baseline gap-x-3">
            <span className="font-medium tabular-nums">{measure.text(version)}</span>
            <Change measure={measure} mine={version} theirs={peers.live} label="live" />
            <Change measure={measure} mine={version} theirs={peers.zero} label="v0" />
        </span>
    );
}

function NoiseNote({
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
        return <p className="text-sm text-muted-foreground">{text}</p>;
    }
    const theirs = reference.version.score ?? 0;
    const delta = version.score - theirs;
    const within = withinNoise(version.score, theirs, rows);
    return (
        <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <span className="tabular-nums">
                {`${pts(delta)} vs ${reference.label} is ${within ? "within" : "beyond"} noise on ${count(rows)} rows`}
            </span>
            <InfoTip label="About the noise check" side="right">
                {`An approximation: a change counts as noise when it is smaller than twice the binomial standard error of the difference, here ${pts(noiseBand(version.score, theirs, rows)).replace(/^\+/, "±")}. It treats both scores as independent samples of ${count(rows)} rows, which overstates the noise a little since both versions answered the same rows.`}
            </InfoTip>
        </p>
    );
}

export function ScoreSection({
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
    const rows = measures(version, versions);
    const columns = [peers.live, peers.zero].filter((item): item is VersionInfo => Boolean(item));
    const columnName = (item: VersionInfo) =>
        item === peers.live ? `live v${item.number}` : `v${item.number}`;
    const held = version.held_out?.examples;
    return (
        <PanelSection
            icon={IconGauge}
            title="Score"
            tip={`Measured on ${held ? `${count(held)} ` : ""}held-out rows the version never trained on. Shares change in points.`}
            flush
        >
            <Table aria-label={`Scores of v${version.number}`}>
                <TableHeader>
                    <TableRow className="hover:bg-transparent">
                        <TableHead className="w-44">Measure</TableHead>
                        <TableHead>
                            {peers.isLive ? `v${version.number} · live` : `v${version.number}`}
                        </TableHead>
                        {columns.map((item) => (
                            <TableHead key={item.number} className="w-28">
                                {columnName(item)}
                            </TableHead>
                        ))}
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {rows.map((measure) => (
                        <TableRow key={measure.id} className="h-9 hover:bg-transparent">
                            <TableCell className="text-muted-foreground">{measure.label}</TableCell>
                            <TableCell>
                                <MineCell
                                    measure={measure}
                                    version={version}
                                    phase={phase}
                                    peers={peers}
                                />
                            </TableCell>
                            {columns.map((item) => (
                                <TableCell key={item.number}>
                                    {scored(item) ? measure.text(item) : "–"}
                                </TableCell>
                            ))}
                        </TableRow>
                    ))}
                </TableBody>
            </Table>
            <div className="border-t px-panel py-2.5">
                <NoiseNote version={version} phase={phase} peers={peers} />
            </div>
        </PanelSection>
    );
}
