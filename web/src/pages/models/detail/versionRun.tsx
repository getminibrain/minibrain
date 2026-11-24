import { IconHourglass, IconRotate } from "@tabler/icons-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button, Link, cn, useToast } from "obp-ui";
import type { ReactNode } from "react";
import {
    type JobDetail,
    type JobInfo,
    type JobMetrics,
    type VersionInfo,
    api,
    unwrap,
} from "~/api/client";
import { useDatasetVersions } from "~/api/dataQueries";
import { keys } from "~/api/queries";
import { canCancel } from "~/components/JobSelection";
import { PoolLink } from "~/components/PoolLink";
import { ErrorLine, PanelSection } from "~/components/Section";
import { ProgressBar } from "~/components/models/StatusText";
import { useCan } from "~/lib/access";
import { count, percent } from "~/lib/format";
import { durationText, jobDuration } from "~/lib/jobs";
import { jobLogsHref } from "~/lib/modelLinks";
import { LossBody, stepText } from "../../jobs/TrainingPanel";
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

const CHART_BOX = "h-[26rem]";
const LOSS_LANE = 184;

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

export type Available = (version: VersionInfo) => number | null;

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

export function presetText(version: VersionInfo, available: Available): string {
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

export type RanOn = { pool: string | null; machine: string | null };

export function ranOn(version: VersionInfo, job: JobDetail | undefined): RanOn | null {
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

export function useAvailableRows(version: VersionInfo): Available {
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
    return <div className={cn("flex flex-col overflow-hidden", CHART_BOX)}>{children}</div>;
}

function Empty({ children }: { children: ReactNode }) {
    return (
        <div
            className={cn(
                "flex items-center justify-center rounded-md border px-3 text-center text-muted-foreground",
                CHART_BOX,
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
        return <Empty>No training run to chart.</Empty>;
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
            <LossBody job={detail} metrics={metrics} lossHeight={LOSS_LANE} />
        </ChartBox>
    );
}

function phaseStats(
    phase: Phase,
    version: VersionInfo,
    run: JobInfo | undefined,
    training: JobMetrics["training"],
    place: RanOn | null,
    rows: number | null,
): ReactNode {
    if (phase === "queued") {
        return (
            <>
                <Progress version={version} label="Training" />
                <Stat
                    label="Status"
                    value={run?.waiting ? "Waiting for a free GPU" : "Waiting for a worker"}
                />
            </>
        );
    }
    if (phase === "training") {
        const eta = training?.eta_seconds;
        return (
            <>
                <Progress version={version} label="Training" />
                <Stat label="Step" value={training ? stepText(training) : "–"} />
                <Stat label="Elapsed" value={run ? jobDuration(run) : "–"} />
                <Stat label="Time left" value={typeof eta === "number" ? durationText(eta) : "–"} />
                <Stat label="Ran on" value={<RanOnText place={place} />} />
            </>
        );
    }
    if (phase === "failed" || phase === "cancelled") {
        const stopped =
            phase === "failed"
                ? "Failed after"
                : finishedBeforeCancel(version)
                  ? "Finished in"
                  : "Cancelled after";
        return (
            <>
                <Stat label={stopped} value={run ? jobDuration(run) : "–"} />
                <Stat label="Reached step" value={training ? stepText(training) : "–"} />
                <Stat label="Ran on" value={<RanOnText place={place} />} />
            </>
        );
    }
    return (
        <>
            <Stat label="Rows trained" value={rows === null ? "–" : count(rows)} />
            <Stat label="Steps" value={training ? stepText(training) : "–"} />
            <Stat label="Ran on" value={<RanOnText place={place} />} />
        </>
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
    const startedFrom = versions.find((item) => item.number === version.from_version);
    const compareTo = startedFrom ?? peers.live ?? previousTrained(versions, version);
    const liveLabel = !startedFrom && compareTo === peers.live ? "live " : "";
    const compareLabel = compareTo ? `${liveLabel}v${compareTo.number}` : "";
    const actions = (
        <span className="flex h-8 items-center gap-2">
            {active && <CancelRun slug={slug} job={active} />}
            <RetryRun slug={slug} version={version} />
        </span>
    );
    const prompt = version.kind === "prompt";
    const stopped = phase === "failed" || phase === "cancelled";
    const changes = changedText(version, compareTo, compareLabel, available);
    const stats = prompt ? (
        <>
            <Stat label="Method" value="Instructions only" />
            <Stat label="Few-shot examples" value={count(version.shots)} />
        </>
    ) : (
        phaseStats(phase, version, run, metrics?.training, ranOn(version, detail), rows)
    );
    const note = prompt ? (
        <Note>The base model with its instructions; no weights of its own.</Note>
    ) : stopped ? (
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
    ) : (
        <Note>
            <span title={changes}>{changes}</span>
        </Note>
    );
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
                {prompt ? (
                    <Empty>
                        {version.number === 0
                            ? "v0 is the prompt-only baseline; it isn't trained."
                            : `v${version.number} is prompt-only; it isn't trained.`}
                    </Empty>
                ) : (
                    <Chart detail={detail} metrics={metrics} />
                )}
            </div>
        </PanelSection>
    );
}
