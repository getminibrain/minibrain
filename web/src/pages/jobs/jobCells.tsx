import type { ColumnDef } from "@tanstack/react-table";
import { Link, Tooltip, TooltipContent, TooltipTrigger, cn } from "obp-ui";
import type { JobInfo } from "~/api/client";
import { ModelName, withDeleted } from "~/components/ModelName";
import { PoolLink } from "~/components/PoolLink";
import { PublisherLogo } from "~/components/PublisherLogo";
import { jobStatusRank } from "~/components/StatusBadge";
import { When } from "~/components/When";
import { StatusText, type Tone } from "~/components/models/StatusText";
import { percent, points } from "~/lib/format";
import { deviceHoursText, durationText, jobDuration, jobSeconds, kindNoun } from "~/lib/jobs";
import { jobHref, modelPageHref } from "~/lib/modelLinks";
import { datasetHref } from "~/pages/models/list/cells";

type JobColumn = ColumnDef<JobInfo, unknown>;

const STATES: Record<string, { tone: Tone; label: string }> = {
    queued: { tone: "neutral", label: "Queued" },
    running: { tone: "info", label: "Running" },
    succeeded: { tone: "success", label: "Done" },
    failed: { tone: "destructive", label: "Failed" },
    cancelled: { tone: "neutral", label: "Cancelled" },
};

function timestamp(value: string | null | undefined): number {
    return value ? new Date(value).getTime() : -1;
}

const METHODS: Record<string, string> = { sft: "SFT" };
const STRATEGIES: Record<string, string> = { lora: "LoRA", qlora: "QLoRA" };

export function jobState(job: JobInfo): { tone: Tone; label: string } {
    if (job.delete_requested) {
        return { tone: "warning", label: "Deleting" };
    }
    if (job.status === "running" && job.cancel_requested) {
        return { tone: "warning", label: "Cancelling" };
    }
    if (job.status === "queued" && job.attempt > 0) {
        return { tone: "warning", label: "Retrying" };
    }
    return STATES[job.status] ?? { tone: "neutral", label: job.status };
}

export function ownerName(job: JobInfo): string {
    return job.model_name ?? job.base_model_name ?? job.model ?? job.base_model ?? "This install";
}

export function jobName(job: JobInfo): string {
    const name = kindNoun(job.kind);
    return job.version === null || job.version === undefined ? name : `${name} v${job.version}`;
}

export function jobRowLabel(job: JobInfo): string {
    return `Job ${job.id}, ${jobName(job)}, ${withDeleted(ownerName(job), job.deleted)}, ${jobState(job).label}`;
}

export function methodText(job: JobInfo): string {
    const method = job.method ? (METHODS[job.method] ?? job.method) : "–";
    const adapter = job.strategy ? (STRATEGIES[job.strategy] ?? job.strategy) : null;
    if (!adapter) {
        return method;
    }
    return job.rank ? `${method} · ${adapter} r${job.rank}` : `${method} · ${adapter}`;
}

export function JobState({ job }: { job: JobInfo }) {
    const state = jobState(job);
    const running = job.status === "running";
    const text = (
        <StatusText
            tone={state.tone}
            active={running}
            waiting={job.status === "queued"}
            progress={running && job.progress > 0 ? job.progress * 100 : null}
        >
            <span className="tabular-nums">
                {state.label}
                {running && job.progress > 0 && ` · ${Math.round(job.progress * 100)}%`}
                {running && job.eta_seconds ? (
                    <span className="text-sm text-muted-foreground">{` · ETA ${durationText(job.eta_seconds)}`}</span>
                ) : null}
            </span>
        </StatusText>
    );
    if (job.status === "failed" && job.error) {
        return (
            <Tooltip>
                <TooltipTrigger asChild>
                    <button type="button" className="flex items-center rounded-sm text-left">
                        {text}
                    </button>
                </TooltipTrigger>
                <TooltipContent className="max-w-sm whitespace-normal">{job.error}</TooltipContent>
            </Tooltip>
        );
    }
    return <span className="flex items-center">{text}</span>;
}

export function JobOwner({ job }: { job: JobInfo }) {
    return (
        <span className="flex min-w-0 items-center gap-2">
            <PublisherLogo
                publisher={job.publisher}
                name={ownerName(job)}
                modelKey={job.model ?? undefined}
                size="sm"
            />
            <ModelName name={ownerName(job)} deleted={job.deleted} className="truncate" />
        </span>
    );
}

export const ID_COLUMN: JobColumn = {
    id: "id",
    header: "Job",
    enableHiding: false,
    accessorFn: (job) => job.id,
    cell: ({ row }) => (
        <Link
            href={jobHref(row.original)}
            className="font-mono text-sm text-foreground hover:underline"
        >
            {`#${row.original.id}`}
        </Link>
    ),
};

export const OWNER_COLUMN: JobColumn = {
    id: "model",
    header: "Model",
    accessorFn: (job) => ownerName(job).toLowerCase(),
    cell: ({ row }) => <JobOwner job={row.original} />,
};

export const STATUS_COLUMN: JobColumn = {
    id: "status",
    header: "Status",
    accessorFn: (job) => jobStatusRank(job.status),
    cell: ({ row }) => <JobState job={row.original} />,
};

export const STARTED_COLUMN: JobColumn = {
    id: "started",
    header: "Started",
    accessorFn: (job) => timestamp(job.started_at ?? job.created_at),
    cell: ({ row }) =>
        row.original.started_at ? (
            <When value={row.original.started_at} />
        ) : (
            <span className="text-muted-foreground">Not yet</span>
        ),
};

export const DURATION_COLUMN: JobColumn = {
    id: "duration",
    header: "Duration",
    accessorFn: jobSeconds,
    cell: ({ row }) => <span className="tabular-nums">{jobDuration(row.original)}</span>,
};

export const POOL_COLUMN: JobColumn = {
    id: "pool",
    header: "Pool",
    accessorFn: (job) => (job.pool ?? "").toLowerCase(),
    cell: ({ row }) =>
        row.original.pool ? (
            <PoolLink name={row.original.pool} />
        ) : (
            <span className="text-muted-foreground">–</span>
        ),
};

export const ATTEMPT_COLUMN: JobColumn = {
    id: "attempt",
    header: "Attempt",
    enableSorting: false,
    accessorFn: (job) => job.attempt,
    cell: ({ row }) => (
        <span className="tabular-nums">{`${Math.max(1, row.original.attempt)} of ${row.original.max_attempts}`}</span>
    ),
};

function changeTone(delta: number, text: string): string {
    if (text === "±0") {
        return "text-muted-foreground";
    }
    return delta > 0 ? "text-success" : "text-destructive";
}

function JobScore({ job }: { job: JobInfo }) {
    const reference = job.compared_with;
    if (job.score === null || job.score === undefined) {
        return <span className="text-muted-foreground">–</span>;
    }
    if (!reference) {
        return <span className="tabular-nums">{percent(job.score)}</span>;
    }
    const delta = job.score - reference.score;
    const change = points(delta);
    const label = `${reference.live ? "live " : ""}v${reference.version}`;
    return (
        <Tooltip>
            <TooltipTrigger asChild>
                <span className="inline-flex items-baseline gap-1.5 whitespace-nowrap tabular-nums">
                    {percent(job.score)}
                    <span className={cn("text-sm", changeTone(delta, change))}>{change}</span>
                </span>
            </TooltipTrigger>
            <TooltipContent>{`vs ${label} · ${percent(reference.score)}`}</TooltipContent>
        </Tooltip>
    );
}

export const SCORE_COLUMN: JobColumn = {
    id: "score",
    header: "Score",
    accessorFn: (job) => job.score ?? -1,
    cell: ({ row }) => <JobScore job={row.original} />,
};

function Muted() {
    return <span className="text-muted-foreground">–</span>;
}

function TrainedOn({ job }: { job: JobInfo }) {
    const on = job.trained_on;
    if (!on) {
        return <Muted />;
    }
    const data =
        on.dataset_version === null || on.dataset_version === undefined
            ? on.dataset
            : `${on.dataset} v${on.dataset_version}`;
    return (
        <span className="flex min-w-0 items-center gap-1.5 whitespace-nowrap">
            <Link
                href={modelPageHref(on.base_model)}
                className="max-w-40 truncate text-foreground hover:underline"
            >
                {on.base_model_name ?? on.base_model}
            </Link>
            {on.dataset && (
                <>
                    <span aria-hidden="true" className="text-muted-foreground">
                        ·
                    </span>
                    <Link
                        href={datasetHref(on.dataset)}
                        className="max-w-40 truncate text-foreground tabular-nums hover:underline"
                    >
                        {data}
                    </Link>
                </>
            )}
        </span>
    );
}

export const TRAINED_ON_COLUMN: JobColumn = {
    id: "trained_on",
    header: "Trained on",
    accessorFn: (job) => {
        const on = job.trained_on;
        return on ? `${on.base_model_name ?? on.base_model} ${on.dataset ?? ""}`.toLowerCase() : "";
    },
    cell: ({ row }) => <TrainedOn job={row.original} />,
};

function DeviceHours({ job }: { job: JobInfo }) {
    const time = job.device_time;
    if (!time) {
        return <Muted />;
    }
    const cpu = time.kind === "cpu";
    const where = cpu ? "the CPU" : time.devices > 1 ? `${time.devices} GPUs` : "1 GPU";
    return (
        <Tooltip>
            <TooltipTrigger asChild>
                <span className="whitespace-nowrap tabular-nums">
                    {deviceHoursText(time)}
                    {cpu && <span className="text-muted-foreground"> CPU</span>}
                </span>
            </TooltipTrigger>
            <TooltipContent>{`${durationText(time.seconds)} of wall time on ${where}`}</TooltipContent>
        </Tooltip>
    );
}

export const DEVICE_HOURS_COLUMN: JobColumn = {
    id: "gpu_hours",
    header: "GPU-hours",
    accessorFn: (job) => job.device_time?.hours ?? -1,
    cell: ({ row }) => <DeviceHours job={row.original} />,
};
