import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Download, Fingerprint, GitBranch, Hourglass } from "lucide-react";
import { Button, Link, cn } from "obp-ui";
import type { ReactNode } from "react";
import {
    type JobDetail,
    type JobInfo,
    type JobMetrics,
    type ModelRow,
    type VersionInfo,
    api,
    unwrap,
} from "~/api/client";
import { useDatasetVersions } from "~/api/dataQueries";
import { useAllModels, useVersionFiles } from "~/api/queries";
import { CopyButton } from "~/components/CopyButton";
import { Facts } from "~/components/Facts";
import { canCancel } from "~/components/JobSelection";
import { PoolLink } from "~/components/PoolLink";
import { ErrorLine, PanelSection } from "~/components/Section";
import { ProgressBar } from "~/components/models/StatusText";
import { useCan } from "~/lib/access";
import { count, percent } from "~/lib/format";
import { durationText, jobDuration } from "~/lib/jobs";
import {
    jobHref,
    jobLogsHref,
    modelCardHref,
    modelPageHref,
    modelVersionHref,
} from "~/lib/modelLinks";
import { bytes } from "~/lib/time";
import { LossBody, stepText } from "../../jobs/TrainingPanel";
import { datasetHref } from "./about";
import { Tip, baseNameOf } from "./header";
import type { Peers, Phase } from "./versionState";
import { failureReason } from "./versions";

const CHART_HEIGHT = "min-h-[29.25rem] xl:min-h-[27.4375rem]";

const SETTINGS: Record<string, [string, (value: unknown) => string]> = {
    strategy: ["adapter", (value) => (value === "qlora" ? "QLoRA" : "LoRA")],
    rank: ["rank", String],
    alpha: ["alpha", String],
    epochs: ["epochs", String],
    learning_rate: ["learning rate", String],
    warmup: ["warmup", (value) => percent(Number(value))],
    scheduler: ["schedule", String],
    dropout: ["dropout", String],
    weight_decay: ["weight decay", String],
    max_rows: ["rows at most", (value) => count(Number(value))],
    micro_batch: ["batch", String],
    grad_accum: ["accumulation", String],
    seq_len: ["sequence", (value) => count(Number(value))],
    seed: ["seed", String],
};

function recipeOf(version: VersionInfo): Record<string, unknown> {
    return version.recipe as Record<string, unknown>;
}

function settingChanges(version: VersionInfo, other: VersionInfo): string[] {
    const mine = recipeOf(version);
    const theirs = recipeOf(other);
    return Object.entries(SETTINGS).flatMap(([key, [name, format]]) => {
        const before = theirs[key];
        const after = mine[key];
        if (after === undefined || after === null || before === undefined || before === null) {
            return [];
        }
        return String(before) === String(after)
            ? []
            : [`${name} ${format(before)} → ${format(after)}`];
    });
}

function dataChange(version: VersionInfo, other: VersionInfo): string | null {
    if (version.dataset_version_id === other.dataset_version_id) {
        return null;
    }
    const delta = (version.dataset_version_rows ?? 0) - (other.dataset_version_rows ?? 0);
    const rows =
        delta === 0 ? "same row count" : `${delta > 0 ? "+" : "−"}${count(Math.abs(delta))} rows`;
    return `data v${other.dataset_version_number ?? "–"} → v${version.dataset_version_number ?? "–"} (${rows})`;
}

export function previousTrained(
    versions: VersionInfo[],
    version: VersionInfo,
): VersionInfo | undefined {
    return versions
        .filter(
            (item) =>
                item.kind === "lora" && item.number < version.number && item.status === "ready",
        )
        .sort((left, right) => right.number - left.number)[0];
}

function settingText(version: VersionInfo, key: string): string {
    const found = SETTINGS[key];
    return found ? `${found[0]} ${found[1](recipeOf(version)[key])}` : key;
}

function recorded(version: VersionInfo): boolean {
    const recipe = recipeOf(version);
    return Object.keys(SETTINGS).some((key) => recipe[key] !== undefined && recipe[key] !== null);
}

function changedText(version: VersionInfo, other: VersionInfo | undefined, label: string): string {
    if (!other || !recorded(other)) {
        const overrides = recipeOf(version).overrides;
        const names = Array.isArray(overrides) ? (overrides as string[]) : [];
        return names.length === 0
            ? "Default settings"
            : `Changed from the defaults: ${names.map((name) => settingText(version, name)).join(", ")}`;
    }
    const parts = [...settingChanges(version, other), dataChange(version, other)].filter(Boolean);
    return parts.length === 0
        ? `Same settings and data as ${label}`
        : `vs ${label}: ${parts.join(", ")}`;
}

function CancelRun({ job }: { job: JobInfo }) {
    const can = useCan();
    const client = useQueryClient();
    const cancel = useMutation({
        mutationFn: () =>
            unwrap(api.POST("/api/jobs/{job_id}/cancel", { params: { path: { job_id: job.id } } })),
        onSettled: () => client.invalidateQueries(),
    });
    if (!can.build || !canCancel(job)) {
        return null;
    }
    return (
        <>
            <ErrorLine error={cancel.error} />
            <Button
                variant="destructive-outline"
                disabled={cancel.isPending}
                onClick={() => cancel.mutate()}
            >
                Cancel
            </Button>
        </>
    );
}

type RanOn = { pool: string | null; machine: string | null };

function ranOn(version: VersionInfo, job: JobDetail | undefined): RanOn | null {
    const parts = [job?.host, job?.device].filter(Boolean);
    if (parts.length > 0) {
        return { pool: job?.pool ?? null, machine: parts.join(" · ") };
    }
    const plan = (version.recipe as { plan?: { machine?: unknown; pool?: unknown } }).plan;
    const machine = typeof plan?.machine === "string" ? plan.machine : null;
    const pool = typeof plan?.pool === "string" && plan.pool ? plan.pool : null;
    return machine || pool ? { pool, machine } : null;
}

function RanOnText({ place }: { place: RanOn | null }) {
    if (!place) {
        return <span className="text-muted-foreground">–</span>;
    }
    if (!place.pool) {
        return <span className="font-mono text-sm">{place.machine}</span>;
    }
    return <PoolLink name={place.pool} machine={place.machine} className="max-w-72" />;
}

function useTrainedRows(version: VersionInfo): number | null {
    const data = useDatasetVersions(version.dataset_slug ?? "", version.kind === "lora");
    const found = data.data?.find((item) => item.id === version.dataset_version_id);
    const rows = found?.counts.train;
    if (rows === undefined) {
        return null;
    }
    const cap = Number(recipeOf(version).max_rows);
    return cap > 0 ? Math.min(rows, cap) : rows;
}

function Progress({ version, label }: { version: VersionInfo; label: string }) {
    const value = version.job?.progress ?? 0;
    return (
        <div className="shrink-0">
            <div className="text-sm text-muted-foreground">{label}</div>
            <div className="flex h-6 items-center gap-2">
                <ProgressBar
                    value={value}
                    label={`v${version.number} ${label.toLowerCase()}`}
                    className="w-28"
                />
                <span className="text-base font-semibold tabular-nums">{`${Math.round(value * 100)}%`}</span>
            </div>
        </div>
    );
}

function Stats({ children }: { children: ReactNode }) {
    return <div className="flex min-h-11 min-w-0 flex-nowrap items-start gap-x-8">{children}</div>;
}

function Stat({ label, value }: { label: string; value: ReactNode }) {
    return (
        <div className="flex min-w-0 shrink-0 flex-col last:shrink">
            <div className="truncate text-sm text-muted-foreground">{label}</div>
            <div className="flex min-w-0 truncate text-base font-semibold tabular-nums">
                {value}
            </div>
        </div>
    );
}

function Note({
    children,
    tone = "muted",
}: { children: ReactNode; tone?: "muted" | "destructive" }) {
    return (
        <p
            className={cn(
                "min-h-5 truncate text-sm",
                tone === "destructive" ? "text-destructive" : "text-muted-foreground",
            )}
        >
            {children}
        </p>
    );
}

function ChartBox({ children }: { children: ReactNode }) {
    return <div className={cn("flex flex-col", CHART_HEIGHT)}>{children}</div>;
}

function Empty({ children }: { children: ReactNode }) {
    return (
        <div
            className={cn(
                "flex items-center justify-center rounded-md border border-dashed px-3 text-center text-muted-foreground",
                CHART_HEIGHT,
            )}
        >
            {children}
        </div>
    );
}

function Chart({
    detail,
    metrics,
}: { detail: JobDetail | undefined; metrics: JobMetrics | undefined }) {
    if (!detail) {
        return <Empty>Loading the training run…</Empty>;
    }
    if (!metrics?.training?.points.length) {
        return (
            <Empty>
                {detail.status === "queued" || detail.status === "running"
                    ? "The loss chart starts with the first training step."
                    : "This run recorded no training steps."}
            </Empty>
        );
    }
    return (
        <ChartBox>
            <LossBody job={detail} metrics={metrics} />
        </ChartBox>
    );
}

export function TrainingSection({
    versions,
    version,
    phase,
    peers,
    run,
    detail,
    metrics,
    metricsError,
    onRetry,
}: {
    versions: VersionInfo[];
    version: VersionInfo;
    phase: Phase;
    peers: Peers;
    run: JobInfo | undefined;
    detail: JobDetail | undefined;
    metrics: JobMetrics | undefined;
    metricsError: unknown;
    onRetry: () => unknown;
}) {
    const rows = useTrainedRows(version);
    const active = version.job && canCancel(version.job) ? version.job : undefined;
    const shownJob = active ?? run;
    const training = metrics?.training;
    const compareTo = peers.live ?? previousTrained(versions, version);
    const compareLabel = peers.live
        ? `live v${peers.live.number}`
        : compareTo
          ? `v${compareTo.number}`
          : "";
    const actions = (
        <>
            {active && <CancelRun job={active} />}
            {shownJob ? (
                <Button variant="outline" asChild>
                    <Link href={jobHref(shownJob)}>{`Job #${shownJob.id}`}</Link>
                </Button>
            ) : (
                <Button variant="outline" disabled>
                    No job
                </Button>
            )}
        </>
    );
    if (version.kind === "prompt") {
        return (
            <PanelSection icon={Hourglass} title="Training" actions={actions}>
                <div className="flex flex-col gap-3">
                    <Stats>
                        <Stat label="Method" value="Instructions only" />
                        <Stat label="Scored in" value={run ? jobDuration(run) : "–"} />
                    </Stats>
                    <Note>The base model with its instructions; no weights of its own.</Note>
                    <Empty>
                        {version.number === 0
                            ? "v0 is the prompt-only baseline; it isn't trained."
                            : `v${version.number} is prompt-only; it isn't trained.`}
                    </Empty>
                </div>
            </PanelSection>
        );
    }
    const place = ranOn(version, detail);
    let stats: ReactNode;
    let note: ReactNode;
    if (phase === "queued") {
        stats = (
            <>
                <Progress version={version} label="Training" />
                <Stat label="Status" value="Waiting for a worker" />
            </>
        );
        note = <Note>{changedText(version, compareTo, compareLabel)}</Note>;
    } else if (phase === "training") {
        const eta = training?.eta_seconds;
        stats = (
            <>
                <Progress version={version} label="Training" />
                <Stat label="Step" value={training ? stepText(training) : "–"} />
                <Stat label="Elapsed" value={run ? jobDuration(run) : "–"} />
                <Stat label="Time left" value={typeof eta === "number" ? durationText(eta) : "–"} />
                <Stat label="Ran on" value={<RanOnText place={place} />} />
            </>
        );
        note = <Note>{changedText(version, compareTo, compareLabel)}</Note>;
    } else if (phase === "failed" || phase === "cancelled") {
        stats = (
            <>
                <Stat
                    label={phase === "failed" ? "Failed after" : "Cancelled after"}
                    value={run ? jobDuration(run) : "–"}
                />
                <Stat label="Reached step" value={training ? stepText(training) : "–"} />
                <Stat label="Ran on" value={<RanOnText place={place} />} />
            </>
        );
        note = (
            <Note tone={phase === "failed" ? "destructive" : "muted"}>
                <span title={failureReason(version)}>{failureReason(version)}</span>
                {run && (
                    <>
                        {" "}
                        <Link href={jobLogsHref(run)} className="text-primary hover:underline">
                            View logs
                        </Link>
                    </>
                )}
            </Note>
        );
    } else {
        stats = (
            <>
                <Stat label="Took" value={run ? jobDuration(run) : "–"} />
                <Stat label="Ran on" value={<RanOnText place={place} />} />
                <Stat label="Rows trained" value={rows === null ? "–" : count(rows)} />
            </>
        );
        note = (
            <Note>
                <span title={changedText(version, compareTo, compareLabel)}>
                    {changedText(version, compareTo, compareLabel)}
                </span>
            </Note>
        );
    }
    return (
        <PanelSection
            icon={Hourglass}
            title="Training"
            tip="Supervised fine-tuning of a LoRA adapter: training and held-out loss per step."
            actions={actions}
        >
            <div className="flex flex-col gap-3">
                <Stats>{stats}</Stats>
                {note}
                <ErrorLine error={metricsError} onRetry={onRetry} />
                <Chart detail={detail} metrics={metrics} />
            </div>
        </PanelSection>
    );
}

function Arrow() {
    return (
        <span aria-hidden="true" className="text-faint">
            →
        </span>
    );
}

export function LineageSection({
    row,
    version,
    peers,
}: {
    row: ModelRow;
    version: VersionInfo;
    peers: Peers;
}) {
    const models = useAllModels();
    const baseKey = version.base_model || row.base_model || "";
    const data =
        version.dataset_version_number !== null && version.dataset_version_number !== undefined;
    const items: ReactNode[] = [
        <Link key="base" href={modelPageHref(baseKey)} className="text-primary hover:underline">
            {baseNameOf(models.data, baseKey)}
        </Link>,
        data && version.dataset_slug ? (
            <Link
                key="data"
                href={datasetHref(version.dataset_slug)}
                className="text-primary hover:underline"
            >
                {`${version.dataset_slug} v${version.dataset_version_number}`}
                <span className="text-muted-foreground tabular-nums">{` · ${count(version.dataset_version_rows ?? 0)} rows`}</span>
            </Link>
        ) : (
            <span key="data" className="text-muted-foreground">
                {data ? `data v${version.dataset_version_number}` : "No data"}
            </span>
        ),
    ];
    if (version.duplicated_from) {
        items.push(
            <Link
                key="copy"
                href={modelVersionHref(
                    version.duplicated_from.slug,
                    version.duplicated_from.number,
                )}
                className="text-primary hover:underline"
            >
                {`copied from ${version.duplicated_from.name} v${version.duplicated_from.number}`}
            </Link>,
        );
    }
    items.push(
        <span key="this" aria-current="page" className="font-semibold">
            {`v${version.number}`}
        </span>,
    );
    const live = peers.isLive ? (
        <span className="text-success">live now</span>
    ) : peers.live ? (
        <span>
            <span className="text-muted-foreground">live is </span>
            <Link
                href={modelVersionHref(row.key, peers.live.number)}
                className="text-primary hover:underline"
            >
                {`v${peers.live.number}`}
            </Link>
        </span>
    ) : (
        <span className="text-muted-foreground">nothing live</span>
    );
    return (
        <PanelSection
            icon={GitBranch}
            title="Lineage"
            tip="The base it runs on and the data it learnt from. The version a run's settings were copied from is not recorded."
        >
            <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                {items.map((item, index) => (
                    <span
                        key={(item as { key: string }).key}
                        className="inline-flex items-baseline gap-2"
                    >
                        {index > 0 && <Arrow />}
                        {item}
                    </span>
                ))}
                <span aria-hidden="true" className="text-faint">
                    ·
                </span>
                {live}
            </p>
        </PanelSection>
    );
}

function artifactHref(id: string): string {
    return `/api/artifacts/${id}`;
}

export function DetailsSection({
    row,
    version,
    phase,
}: {
    row: ModelRow;
    version: VersionInfo;
    phase: Phase;
}) {
    const pending =
        phase === "failed" || phase === "cancelled"
            ? "None: training did not finish"
            : "Once training finishes";
    const can = useCan();
    const callable = `${row.key}@${version.number}`;
    const files = useVersionFiles(
        row.key,
        version.kind === "lora" && version.status === "ready" ? version.number : null,
    );
    const sha = files.data?.artifact_id;
    const adapter =
        version.kind === "prompt" ? (
            <span className="text-muted-foreground">
                None: a prompt-only version has no weights
            </span>
        ) : sha ? (
            <span className="flex min-w-0 items-center gap-1">
                <Tip tip={sha}>
                    <span className="cursor-default font-mono text-sm">{`sha256:${sha.slice(0, 12)}`}</span>
                </Tip>
                <span className="-my-1.5">
                    <CopyButton value={sha} label="Copy SHA-256" />
                </span>
            </span>
        ) : (
            <span className="text-muted-foreground">{pending}</span>
        );
    const exported =
        sha && can.build ? (
            <a
                href={artifactHref(sha)}
                download
                className="inline-flex h-5 items-center gap-1.5 text-primary hover:underline"
            >
                <Download aria-hidden="true" className="size-4" />
                {`Adapter, ${bytes(files.data?.size)} · safetensors in a tar`}
            </a>
        ) : (
            <span className="text-muted-foreground">
                {version.kind === "prompt"
                    ? "Nothing to export"
                    : sha
                      ? "Builders can download the adapter"
                      : pending}
            </span>
        );
    return (
        <PanelSection icon={Fingerprint} title="Details">
            <Facts
                items={[
                    [
                        "API name",
                        <span key="api" className="flex items-center gap-0.5">
                            <span className="font-mono text-sm">{callable}</span>
                            <span className="-my-1.5">
                                <CopyButton value={callable} label={`Copy ${callable}`} />
                            </span>
                        </span>,
                    ],
                    ["Adapter", adapter],
                    ["Export", exported],
                    [
                        "Model card",
                        <Link
                            key="card"
                            href={modelCardHref(row.key, version.number)}
                            className="text-primary hover:underline"
                        >
                            {`Model card of v${version.number} →`}
                        </Link>,
                    ],
                ]}
            />
        </PanelSection>
    );
}
