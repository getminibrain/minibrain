import {
    IconDownload,
    IconFingerprint,
    IconGitBranch,
    IconHourglass,
    IconRotate,
} from "@tabler/icons-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button, Link, cn, useToast } from "obp-ui";
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
import { keys, useAllModels, useVersionFiles } from "~/api/queries";
import { CopyButton } from "~/components/CopyButton";
import { Facts } from "~/components/Facts";
import { canCancel } from "~/components/JobSelection";
import { PoolLink } from "~/components/PoolLink";
import { ErrorLine, PanelSection } from "~/components/Section";
import { ProgressBar } from "~/components/models/StatusText";
import { useCan } from "~/lib/access";
import { count, percent } from "~/lib/format";
import { deviceHoursText, durationText, jobDuration } from "~/lib/jobs";
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
import {
    type RunValues,
    type SettingChange,
    cappedRows,
    labelOf,
    presetChanges,
    recordedRun,
} from "./train/recipe";
import type { Peers, Phase } from "./versionState";
import { failureReason, finishedBeforeCancel, retry } from "./versions";

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

type Available = (version: VersionInfo) => number | null;

function recipeOf(version: VersionInfo): Record<string, unknown> {
    return version.recipe as Record<string, unknown>;
}

function numberOf(value: unknown): number | null {
    const found = Number(value);
    return value === null || value === undefined || !Number.isFinite(found) ? null : found;
}

function shownSetting(version: VersionInfo, key: string, available: Available): unknown {
    const value = recipeOf(version)[key];
    if (key !== "max_rows" || value === undefined || value === null) {
        return value;
    }
    const rows = available(version);
    return rows !== null && cappedRows(numberOf(value), rows) === null ? "all" : value;
}

function settingChanges(version: VersionInfo, other: VersionInfo, available: Available): string[] {
    return Object.entries(SETTINGS).flatMap(([key, [name, format]]) => {
        const before = shownSetting(other, key, available);
        const after = shownSetting(version, key, available);
        if (after === undefined || after === null || before === undefined || before === null) {
            return [];
        }
        const text = (value: unknown) => (value === "all" ? "all" : format(value));
        return String(before) === String(after) ? [] : [`${name} ${text(before)} → ${text(after)}`];
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

function changeText(version: VersionInfo, change: SettingChange): string {
    const found = SETTINGS[change.key];
    if (!found || change.before === null || change.after === null) {
        return settingText(version, change.key);
    }
    return `${found[0]} ${found[1](change.before)} → ${found[1](change.after)}`;
}

function runValues(version: VersionInfo, available: Available): RunValues {
    const recipe = recipeOf(version);
    const overrides = Array.isArray(recipe.overrides) ? (recipe.overrides as string[]) : [];
    return {
        rank: numberOf(recipe.rank),
        epochs: numberOf(recipe.epochs),
        learningRate: numberOf(recipe.learning_rate),
        maxRows: numberOf(recipe.max_rows),
        available: available(version),
        overrides,
    };
}

function presetText(version: VersionInfo, available: Available): string {
    const run = runValues(version, available);
    if (!recordedRun(run)) {
        return "Default settings";
    }
    const { basis, changes } = presetChanges(run);
    const label = labelOf(basis);
    return changes.length === 0
        ? `${label} preset`
        : `Changed from ${label}: ${changes.map((change) => changeText(version, change)).join(", ")}`;
}

function recorded(version: VersionInfo): boolean {
    const recipe = recipeOf(version);
    return Object.keys(SETTINGS).some((key) => recipe[key] !== undefined && recipe[key] !== null);
}

function changedText(
    version: VersionInfo,
    other: VersionInfo | undefined,
    label: string,
    available: Available = () => null,
): string {
    if (!other || !recorded(other)) {
        return presetText(version, available);
    }
    const parts = [...settingChanges(version, other, available), dataChange(version, other)].filter(
        Boolean,
    );
    return parts.length === 0
        ? `Same settings and data as ${label}`
        : `vs ${label}: ${parts.join(", ")}`;
}

function DeviceHours({ version }: { version: VersionInfo }) {
    const time = version.device_time;
    if (!time) {
        return <Stat label="GPU-hours" value="–" />;
    }
    const label = time.kind === "cpu" ? "CPU-hours" : "GPU-hours";
    const devices = time.kind === "gpu" && time.devices > 1 ? ` on ${time.devices} GPUs` : "";
    return (
        <Stat
            label={label}
            value={
                <span title={`${durationText(time.seconds)} of wall time${devices}`}>
                    {deviceHoursText(time)}
                </span>
            }
        />
    );
}

function RetryRun({ slug, version }: { slug: string; version: VersionInfo }) {
    const can = useCan();
    const client = useQueryClient();
    const toast = useToast();
    const again = useMutation({
        mutationFn: () => retry(slug, version.number),
        onSuccess: () => client.invalidateQueries(),
        onError: async (error) => {
            toast({ title: "Retry failed", description: error.message, tone: "destructive" });
            await client.invalidateQueries();
        },
    });
    if (!can.build || version.status !== "failed") {
        return null;
    }
    return (
        <Button variant="outline" disabled={again.isPending} onClick={() => again.mutate()}>
            <IconRotate aria-hidden="true" />
            Retry
        </Button>
    );
}

function markCancelling(versions: VersionInfo[] | undefined, jobId: number) {
    return versions?.map((item) =>
        item.job?.id === jobId ? { ...item, job: { ...item.job, cancel_requested: true } } : item,
    );
}

function CancelRun({ slug, job }: { slug: string; job: JobInfo }) {
    const can = useCan();
    const client = useQueryClient();
    const cancel = useMutation({
        mutationFn: () =>
            unwrap(api.POST("/api/jobs/{job_id}/cancel", { params: { path: { job_id: job.id } } })),
        onMutate: () =>
            client.setQueryData<VersionInfo[]>(keys.versions(slug), (old) =>
                markCancelling(old, job.id),
            ),
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

function useAvailableRows(version: VersionInfo): Available {
    const data = useDatasetVersions(version.dataset_slug ?? "", version.kind === "lora");
    return (item) => {
        const found = data.data?.find((entry) => entry.id === item.dataset_version_id);
        return found ? (found.counts.train ?? 0) + (found.feedback_rows ?? 0) : null;
    };
}

function useTrainedRows(version: VersionInfo): number | null {
    const recipe = recipeOf(version);
    const measured = Number(recipe.examples);
    const data = useDatasetVersions(
        version.dataset_slug ?? "",
        version.kind === "lora" && !(measured > 0),
    );
    if (measured > 0) {
        return measured;
    }
    const found = data.data?.find((item) => item.id === version.dataset_version_id);
    const rows = found?.counts.train;
    if (rows === undefined) {
        return null;
    }
    const cap = Number(recipe.max_rows);
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
    slug,
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
    slug: string;
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
    const available = useAvailableRows(version);
    const active = version.job && canCancel(version.job) ? version.job : undefined;
    const shownJob = active ?? run;
    const training = metrics?.training;
    const startedFrom = versions.find((item) => item.number === version.from_version);
    const compareTo = startedFrom ?? peers.live ?? previousTrained(versions, version);
    const liveLabel = !startedFrom && compareTo === peers.live ? "live " : "";
    const compareLabel = compareTo ? `${liveLabel}v${compareTo.number}` : "";
    const actions = (
        <>
            {active && <CancelRun slug={slug} job={active} />}
            <RetryRun slug={slug} version={version} />
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
            <PanelSection icon={IconHourglass} title="Training" actions={actions}>
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
        note = <Note>{changedText(version, compareTo, compareLabel, available)}</Note>;
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
        note = <Note>{changedText(version, compareTo, compareLabel, available)}</Note>;
    } else if (phase === "failed" || phase === "cancelled") {
        stats = (
            <>
                <Stat
                    label={
                        phase === "failed"
                            ? "Failed after"
                            : finishedBeforeCancel(version)
                              ? "Finished in"
                              : "Cancelled after"
                    }
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
                <DeviceHours version={version} />
            </>
        );
        note = (
            <Note>
                <span title={changedText(version, compareTo, compareLabel, available)}>
                    {changedText(version, compareTo, compareLabel, available)}
                </span>
            </Note>
        );
    }
    return (
        <PanelSection
            icon={IconHourglass}
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
    if (version.from_version !== null && version.from_version !== undefined) {
        items.push(
            <Link
                key="from"
                href={modelVersionHref(row.key, version.from_version)}
                className="text-primary hover:underline"
            >
                {`started from v${version.from_version}`}
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
            icon={IconGitBranch}
            title="Lineage"
            tip="The base it runs on, the data it learnt from and the version its settings started from."
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
                <IconDownload aria-hidden="true" className="size-4" />
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
        <PanelSection icon={IconFingerprint} title="Details">
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
