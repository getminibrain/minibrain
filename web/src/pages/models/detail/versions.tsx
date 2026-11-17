import {
    IconDots,
    IconGitCompare,
    IconHistory,
    IconLogs,
    IconRepeat,
    IconRocket,
    IconRotate,
    IconTrash,
    IconX,
} from "@tabler/icons-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import type { ColumnDef } from "@tanstack/react-table";
import {
    Badge,
    Button,
    DataGrid,
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuSub,
    DropdownMenuSubContent,
    DropdownMenuSubTrigger,
    DropdownMenuTrigger,
    Link,
    Tooltip,
    TooltipContent,
    TooltipTrigger,
    useToast,
} from "obp-ui";
import { useMemo, useState } from "react";
import {
    type JobInfo,
    type ModelDetail,
    type ModelRow,
    type VersionInfo,
    api,
    unwrap,
} from "~/api/client";
import { useJobs } from "~/api/queries";
import { PanelSection, PanelSections } from "~/components/Section";
import { When } from "~/components/When";
import { StatusText, type Tone, percentOf } from "~/components/models/StatusText";
import { useCan } from "~/lib/access";
import { percent, points } from "~/lib/format";
import { durationText, jobSeconds } from "~/lib/jobs";
import { metricName } from "~/lib/metrics";
import {
    jobHref,
    jobLogsHref,
    modelCompareHref,
    modelVersionHref,
    trainHref,
} from "~/lib/modelLinks";
import { ConfirmAction, type Confirmation } from "../dialogs";
import { Tip, isDeployed } from "./header";
import {
    DeployVersionDialog,
    canGoLive,
    isBaseline,
    liveBlock,
    liveOf,
    readyToDeploy,
    ruleReason,
    versionLabel,
} from "./makeLive";
import { ScoredBy } from "./scoredBy";
import { labelOf, startFrom } from "./train/recipe";

export function isCancelled(version: VersionInfo): boolean {
    return version.status === "failed" && version.job?.status === "cancelled";
}

export function finishedBeforeCancel(version: VersionInfo): boolean {
    return isCancelled(version) && (version.job?.progress ?? 0) >= 1;
}

export function cancelling(version: VersionInfo): boolean {
    const job = version.job;
    return (
        Boolean(job?.cancel_requested) && (job?.status === "running" || job?.status === "queued")
    );
}

export function failureReason(version: VersionInfo): string {
    if (finishedBeforeCancel(version)) {
        return "Finished before the cancel took effect; its result was not kept.";
    }
    if (isCancelled(version)) {
        return "Cancelled before it finished.";
    }
    return version.job?.error ?? "No reason was recorded.";
}

const IN_PROGRESS = new Set(["training", "evaluating"]);

type ShownStatus = {
    tone: Tone;
    label: string;
    active?: boolean;
    waiting?: boolean;
    progress?: number | null;
};

function jobProgress(version: VersionInfo): Pick<ShownStatus, "active" | "progress"> {
    const share = version.job?.progress ?? 0;
    return share > 0 ? { progress: percentOf(share) } : { active: true };
}

function shareText(version: VersionInfo): string {
    const share = version.job?.progress ?? 0;
    return share > 0 ? ` ${Math.round(share * 100)}%` : "";
}

export function inFlight(version: VersionInfo): boolean {
    return version.status === "queued" || (IN_PROGRESS.has(version.status) && !cancelling(version));
}

function activityLabel(version: VersionInfo): string {
    const name = `v${version.number}`;
    if (version.status === "queued" || version.job?.status === "queued") {
        return `Queued ${name}`;
    }
    const verb = version.status === "training" ? "Training" : "Scoring";
    const share = version.job?.progress ?? 0;
    const eta = version.job?.eta_seconds;
    return [
        `${verb} ${name}`,
        share > 0 ? `${Math.round(share * 100)}%` : null,
        eta ? `about ${durationText(eta)}` : null,
    ]
        .filter(Boolean)
        .join(" · ");
}

export function VersionActivity({ row, versions }: { row: ModelRow; versions: VersionInfo[] }) {
    const running = newestFirst(versions).filter(inFlight);
    const [shown] = running;
    if (!shown) {
        return null;
    }
    const status = versionStatus(row, shown);
    const more = running.length - 1;
    return (
        <Link
            href={modelVersionHref(row.key, shown.number)}
            className="text-inherit hover:underline"
        >
            <StatusText
                tone={status.tone}
                active={status.active}
                waiting={status.waiting}
                progress={status.progress}
            >
                <span className="tabular-nums">
                    {activityLabel(shown)}
                    {more > 0 && <span className="text-muted-foreground">{` · ${more} more`}</span>}
                </span>
            </StatusText>
        </Link>
    );
}

export function versionStatus(row: ModelRow, version: VersionInfo): ShownStatus {
    if (version.current && row.deployment.state === "starting") {
        return row.deployment.waiting
            ? { tone: "warning", label: "Waiting for a machine", waiting: true }
            : { tone: "info", label: "Deploying", active: true };
    }
    if (version.current && isDeployed(row)) {
        return { tone: "success", label: "Deployed" };
    }
    if (cancelling(version)) {
        return { tone: "warning", label: "Cancelling…", active: true };
    }
    if (
        version.status === "queued" ||
        (IN_PROGRESS.has(version.status) && version.job?.status === "queued")
    ) {
        return { tone: "neutral", label: "Queued", waiting: true };
    }
    if (version.status === "training") {
        return { tone: "info", label: `Training${shareText(version)}`, ...jobProgress(version) };
    }
    if (version.status === "evaluating") {
        return { tone: "info", label: `Scoring${shareText(version)}`, ...jobProgress(version) };
    }
    if (isCancelled(version)) {
        return { tone: "neutral", label: "Cancelled" };
    }
    if (version.status === "failed") {
        return { tone: "destructive", label: "Failed" };
    }
    if (version.status === "deleting") {
        return { tone: "neutral", label: "Deleting", active: true };
    }
    if (version.live_at) {
        return { tone: "neutral", label: "Was deployed" };
    }
    return { tone: "neutral", label: "Ready" };
}

const STATUS_ORDER = [
    "Deployed",
    "Deploying",
    "Waiting for a machine",
    "Training",
    "Scoring",
    "Queued",
    "Cancelling…",
    "Ready",
    "Was deployed",
    "Cancelled",
    "Failed",
    "Deleting",
];

export function versionStatusRank(row: ModelRow, version: VersionInfo): number {
    const label = versionStatus(row, version).label;
    const index = STATUS_ORDER.findIndex((name) => label.startsWith(name));
    return index === -1 ? STATUS_ORDER.length : index;
}

export function VersionStatus({ row, version }: { row: ModelRow; version: VersionInfo }) {
    const status = versionStatus(row, version);
    const text = (
        <StatusText
            tone={status.tone}
            active={status.active}
            waiting={status.waiting}
            progress={status.progress}
        >
            <span className="tabular-nums">{status.label}</span>
        </StatusText>
    );
    const error = version.status === "failed" ? version.job?.error : null;
    return error ? <Tip tip={error}>{text}</Tip> : text;
}

function RunStatus({ row, version }: { row: ModelRow; version: VersionInfo }) {
    const job = version.job;
    if (version.status === "failed" && job) {
        return (
            <Tip tip={failureReason(version)}>
                <Link href={jobHref(job)} className="hover:underline">
                    <StatusText tone={isCancelled(version) ? "neutral" : "destructive"}>
                        {`${isCancelled(version) ? "Cancelled" : "Failed"} · job #${job.id}`}
                    </StatusText>
                </Link>
            </Tip>
        );
    }
    return <VersionStatus row={row} version={version} />;
}

const PRESET_SETTINGS = new Set(["rank", "epochs", "learning_rate", "max_rows", "seed"]);

export function trainingText(version: VersionInfo): string {
    if (version.kind === "prompt") {
        return "Instructions";
    }
    const recipe = version.recipe as Record<string, unknown>;
    const overrides = Array.isArray(recipe.overrides) ? (recipe.overrides as string[]) : [];
    if (overrides.length === 0) {
        return "Default";
    }
    const start = startFrom(recipe);
    if (start.custom || overrides.some((name) => !PRESET_SETTINGS.has(name))) {
        return "Custom";
    }
    return labelOf(start.basis);
}

export function recipeText(version: VersionInfo): string {
    const data =
        version.dataset_version_number !== null && version.dataset_version_number !== undefined
            ? `data v${version.dataset_version_number}`
            : "no data";
    if (version.kind === "prompt") {
        return `Instructions only · ${data}`;
    }
    const recipe = version.recipe as { strategy?: string; rank?: number };
    const adapter = recipe.strategy === "qlora" ? "QLoRA" : "LoRA";
    return `SFT · ${adapter}${recipe.rank ? ` r${recipe.rank}` : ""} · ${data}`;
}

export function runJob(version: VersionInfo, jobs: JobInfo[]): JobInfo | undefined {
    const own = jobs.filter((job) => job.version === version.number);
    const wanted = version.kind === "lora" ? "train" : "eval";
    return (
        own.find((job) => job.kind === wanted) ??
        own.find((job) => job.kind === "eval") ??
        version.job ??
        undefined
    );
}

export function ScoreBadge({
    row,
    version,
    versions,
}: { row: ModelRow; version: VersionInfo; versions: VersionInfo[] }) {
    if (isBaseline(version) || version.status !== "ready" || version.score === null) {
        return null;
    }
    const live = isDeployed(row) ? liveOf(versions) : undefined;
    if (live?.number === version.number) {
        return null;
    }
    if (version.promotion && !version.promotion.passed && !version.live_at) {
        return (
            <Tooltip>
                <TooltipTrigger asChild>
                    <Badge variant="neutral" tabIndex={0}>
                        misses deploy rule
                    </Badge>
                </TooltipTrigger>
                <TooltipContent className="max-w-xs whitespace-normal">
                    {ruleReason(version)}
                </TooltipContent>
            </Tooltip>
        );
    }
    if (live && live.score !== null && version.score > live.score) {
        return <Badge variant="success">{`${points(version.score - live.score)} vs live`}</Badge>;
    }
    return null;
}

function newestFirst(versions: VersionInfo[]): VersionInfo[] {
    return [...versions].sort((a, b) => b.number - a.number);
}

export function retry(name: string, number: number) {
    return unwrap(
        api.POST("/api/models/{name}/versions/{number}/retry", {
            params: { path: { name, number } },
        }),
    );
}

function busy(version: VersionInfo): boolean {
    return version.status === "training" || version.status === "evaluating";
}

function durationOf(job: JobInfo | undefined): string {
    const seconds = job ? jobSeconds(job) : -1;
    return seconds < 0 ? "–" : durationText(seconds);
}

function RowMenu({
    row,
    version,
    versions,
    job,
    onDelete,
}: {
    row: ModelRow;
    version: VersionInfo;
    versions: VersionInfo[];
    job: JobInfo | undefined;
    onDelete: () => void;
}) {
    const can = useCan();
    const router = useRouter();
    const others = versions
        .filter(
            (item) =>
                item.number !== version.number && item.status === "ready" && item.score !== null,
        )
        .sort((a, b) => b.number - a.number);
    const comparable = version.status === "ready" && version.score !== null && others.length > 0;
    const isLive = isDeployed(row) && row.current_version === version.number;
    const baseline = version.number === 0;
    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`More actions for v${version.number}`}
                >
                    <IconDots />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuSub>
                    <DropdownMenuSubTrigger disabled={!comparable}>
                        <IconGitCompare />
                        Compare with…
                    </DropdownMenuSubTrigger>
                    <DropdownMenuSubContent className="w-48">
                        {others.map((item) => (
                            <DropdownMenuItem
                                key={item.number}
                                onSelect={() =>
                                    router.history.push(
                                        modelCompareHref(
                                            row.key,
                                            Math.min(item.number, version.number),
                                            Math.max(item.number, version.number),
                                        ),
                                    )
                                }
                            >
                                {versionLabel(item)}
                                {item.current && isDeployed(row) && (
                                    <span className="ml-auto text-sm text-muted-foreground">
                                        Deployed
                                    </span>
                                )}
                            </DropdownMenuItem>
                        ))}
                    </DropdownMenuSubContent>
                </DropdownMenuSub>
                {can.build && version.kind === "lora" && (
                    <DropdownMenuItem
                        disabled={busy(version)}
                        onSelect={() =>
                            router.history.push(trainHref(row.key, { from: version.number }))
                        }
                    >
                        <IconRepeat />
                        Train again
                    </DropdownMenuItem>
                )}
                <DropdownMenuItem
                    disabled={!job}
                    onSelect={() => job && router.history.push(jobLogsHref(job))}
                >
                    <IconLogs />
                    {job ? `Logs · job #${job.id}` : "Logs"}
                </DropdownMenuItem>
                {can.build && (
                    <>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                            variant="destructive"
                            disabled={isLive || baseline}
                            onSelect={onDelete}
                        >
                            <IconTrash />
                            {baseline
                                ? "Delete (v0 is the baseline)"
                                : isLive
                                  ? "Delete (deployed)"
                                  : "Delete"}
                        </DropdownMenuItem>
                    </>
                )}
            </DropdownMenuContent>
        </DropdownMenu>
    );
}

function VersionActions({
    row,
    version,
    versions,
    job,
    onLive,
    onDelete,
}: {
    row: ModelRow;
    version: VersionInfo;
    versions: VersionInfo[];
    job: JobInfo | undefined;
    onLive: () => void;
    onDelete: () => void;
}) {
    const can = useCan();
    const router = useRouter();
    const client = useQueryClient();
    const toast = useToast();
    const again = useMutation({
        mutationFn: () => retry(row.key, version.number),
        onSuccess: async () => {
            await client.invalidateQueries();
            router.history.push(modelVersionHref(row.key, version.number));
        },
        onError: async (error) => {
            toast({ title: "Retry failed", description: error.message, tone: "destructive" });
            await client.invalidateQueries();
        },
    });
    const failed = version.status === "failed";
    const live = canGoLive(row, version);
    const blocked = live ? liveBlock(row, version) : null;
    const pinned = pinnedDeploy(row, version, isDeployed(row) ? liveOf(versions) : undefined);
    return (
        <>
            {can.build && failed && (
                <Button variant="outline" disabled={again.isPending} onClick={() => again.mutate()}>
                    <IconRotate aria-hidden="true" />
                    Retry
                </Button>
            )}
            {can.build && live && !blocked && !pinned && (
                <Button variant="outline" onClick={onLive}>
                    <IconRocket aria-hidden="true" />
                    {`Deploy v${version.number}`}
                </Button>
            )}
            <RowMenu
                row={row}
                version={version}
                versions={versions}
                job={job}
                onDelete={onDelete}
            />
        </>
    );
}

function pinnedDeploy(row: ModelRow, version: VersionInfo, live: VersionInfo | undefined): boolean {
    return readyToDeploy(version, live) && canGoLive(row, version) && !liveBlock(row, version);
}

function DeployNow({ onDeploy }: { onDeploy: () => void }) {
    return (
        <Button variant="outline" size="sm" className="relative z-10 -my-1.5" onClick={onDeploy}>
            <IconRocket aria-hidden="true" />
            Deploy
        </Button>
    );
}

function versionColumns(
    row: ModelRow,
    versions: VersionInfo[],
    jobs: JobInfo[],
    metric: string,
    deploy: ((number: number) => void) | null,
): ColumnDef<VersionInfo, unknown>[] {
    const live = isDeployed(row) ? liveOf(versions) : undefined;
    return [
        {
            id: "version",
            header: "Version",
            accessorFn: (version) => version.number,
            enableHiding: false,
            cell: ({ row: { original: version } }) => (
                <span className="whitespace-nowrap">
                    <Tip tip={version.note}>
                        <Link
                            href={modelVersionHref(row.key, version.number)}
                            className="relative z-10 font-medium tabular-nums hover:underline"
                        >
                            {versionLabel(version)}
                        </Link>
                    </Tip>
                    {isBaseline(version) && (
                        <span className="ml-2 text-sm text-muted-foreground">untrained</span>
                    )}
                </span>
            ),
        },
        {
            id: "status",
            header: "Status",
            accessorFn: (version) => versionStatusRank(row, version),
            cell: ({ row: { original: version } }) => (
                <span className="inline-flex items-center gap-3">
                    <RunStatus row={row} version={version} />
                    {deploy && pinnedDeploy(row, version, live) && (
                        <DeployNow onDeploy={() => deploy(version.number)} />
                    )}
                </span>
            ),
        },
        {
            id: "score",
            header: metric,
            accessorFn: (version) => version.score ?? -1,
            cell: ({ row: { original: version } }) => (
                <span className="inline-flex items-center gap-2 tabular-nums">
                    {version.score === null ? "–" : percent(version.score)}
                    <ScoreBadge row={row} version={version} versions={versions} />
                </span>
            ),
        },
        {
            id: "note",
            header: "Note",
            accessorFn: (version) => version.note ?? "",
            cell: ({ row: { original: version } }) =>
                version.note ? (
                    <span className="block max-w-64 truncate text-muted-foreground">
                        {version.note}
                    </span>
                ) : (
                    <span className="text-muted-foreground">–</span>
                ),
        },
        {
            id: "data",
            header: "Data",
            accessorFn: (version) => version.dataset_version_number ?? -1,
            cell: ({ row: { original: version } }) => {
                const data = version.dataset_version_number;
                return data === null || data === undefined ? (
                    <span className="text-muted-foreground">–</span>
                ) : (
                    <span className="tabular-nums">{`v${data}`}</span>
                );
            },
        },
        {
            id: "training",
            header: "Training",
            accessorFn: trainingText,
            cell: ({ row: { original: version } }) => (
                <span className="whitespace-nowrap">{trainingText(version)}</span>
            ),
        },
        {
            id: "started",
            header: "Started",
            accessorFn: (version) =>
                Date.parse(runJob(version, jobs)?.started_at ?? version.created_at),
            cell: ({ row: { original: version } }) => (
                <span className="text-muted-foreground">
                    <When value={runJob(version, jobs)?.started_at ?? version.created_at} />
                </span>
            ),
        },
        {
            id: "duration",
            header: "Duration",
            accessorFn: (version) => {
                const job = runJob(version, jobs);
                return job ? jobSeconds(job) : -1;
            },
            cell: ({ row: { original: version } }) => (
                <span className="whitespace-nowrap tabular-nums">
                    {durationOf(runJob(version, jobs))}
                </span>
            ),
        },
    ];
}

function deleteVersions(row: ModelRow, numbers: number[]) {
    return Promise.all(
        numbers.map((number) =>
            unwrap(
                api.DELETE("/api/models/{name}/versions/{number}", {
                    params: { path: { name: row.key, number }, query: { cancel_jobs: true } },
                }),
            ),
        ),
    );
}

function VersionsTable({ row, versions }: { row: ModelRow; versions: VersionInfo[] }) {
    const router = useRouter();
    const toast = useToast();
    const client = useQueryClient();
    const can = useCan();
    const jobs = useJobs(row.key);
    const [picked, setPicked] = useState<number[]>([]);
    const [promoting, setPromoting] = useState<number | null>(null);
    const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
    const ordered = newestFirst(versions);
    const chosen = versions.filter((version) => picked.includes(version.number));
    const sorted = chosen
        .filter((version) => version.score !== null)
        .map((version) => version.number)
        .sort((a, b) => a - b);
    const liveNumber = isDeployed(row) ? row.current_version : null;
    const deletable = chosen.filter(
        (version) => version.number !== liveNumber && version.number !== 0,
    );
    const metric = metricName(versions.find((version) => version.main_metric)?.main_metric);
    const columns = useMemo(
        () =>
            versionColumns(row, versions, jobs.data ?? [], metric, can.build ? setPromoting : null),
        [row, versions, jobs.data, metric, can.build],
    );
    const keptText = (doomed: VersionInfo[]) => {
        const kept = chosen
            .filter((version) => !doomed.includes(version))
            .map((version) =>
                version.number === 0 ? "Baseline v0" : `Deployed v${version.number}`,
            );
        return kept.length > 0
            ? ` ${kept.join(" and ")} ${kept.length === 1 ? "is" : "are"} kept.`
            : "";
    };
    const remove = (doomed: VersionInfo[], kept: boolean) =>
        setConfirmation({
            title:
                doomed.length === 1
                    ? `Delete ${versionLabel(doomed[0])} of ${row.name}?`
                    : `Delete ${doomed.length} versions of ${row.name}?`,
            description: (
                <p>
                    {`${doomed.map((version) => `${row.key}@${version.number}`).join(", ")} ${doomed.length === 1 ? "stops" : "stop"} answering; adapters, scores and cards are removed, and their running jobs are cancelled.`}
                    {kept && keptText(doomed)}
                </p>
            ),
            confirmLabel: doomed.length === 1 ? "Delete version" : "Delete versions",
            destructive: true,
            run: async () => {
                const numbers = doomed.map((version) => version.number);
                await deleteVersions(row, numbers);
                await client.invalidateQueries();
                setPicked(picked.filter((number) => !numbers.includes(number)));
                toast({
                    title: `Deleted ${doomed.length} ${doomed.length === 1 ? "version" : "versions"}`,
                    tone: "success",
                });
            },
        });
    return (
        <PanelSection
            icon={IconHistory}
            title="Versions"
            actions={
                picked.length > 0 && (
                    <>
                        <Button variant="outline" onClick={() => setPicked([])}>
                            <IconX aria-hidden="true" />
                            Clear
                        </Button>
                        <Tip
                            tip={
                                sorted.length === 2
                                    ? null
                                    : "Tick two scored versions to compare them."
                            }
                        >
                            <Button
                                variant="outline"
                                disabled={sorted.length !== 2}
                                onClick={() =>
                                    router.history.push(
                                        modelCompareHref(row.key, sorted[0], sorted[1]),
                                    )
                                }
                            >
                                <IconGitCompare aria-hidden="true" />
                                {sorted.length === 2
                                    ? `Compare v${sorted[0]} and v${sorted[1]}`
                                    : "Compare"}
                            </Button>
                        </Tip>
                        {can.build && (
                            <Tip
                                tip={
                                    deletable.length === 0
                                        ? "v0 and the deployed version cannot be deleted."
                                        : null
                                }
                            >
                                <Button
                                    variant="destructive"
                                    disabled={deletable.length === 0}
                                    onClick={() =>
                                        remove(deletable, chosen.length > deletable.length)
                                    }
                                >
                                    <IconTrash aria-hidden="true" />
                                    {deletable.length > 0 ? `Delete ${deletable.length}` : "Delete"}
                                </Button>
                            </Tip>
                        )}
                    </>
                )
            }
            bare
        >
            <DataGrid
                columns={columns}
                rows={ordered}
                getRowId={(version) => String(version.number)}
                initialSort={[{ id: "version", desc: true }]}
                storageKey="minibrain.model-versions.columns"
                columnPicker
                hiddenColumns={["note", "training", "duration"]}
                selectedIds={picked.map(String)}
                onSelectedIdsChange={(ids) => setPicked(ids.map(Number))}
                onOpen={(version) => router.history.push(modelVersionHref(row.key, version.number))}
                rowLabel={(version) => versionLabel(version)}
                rowActions={(version) => (
                    <VersionActions
                        row={row}
                        version={version}
                        versions={versions}
                        job={runJob(version, jobs.data ?? [])}
                        onLive={() => setPromoting(version.number)}
                        onDelete={() => remove([version], false)}
                    />
                )}
                empty={<p className="text-muted-foreground">No versions yet.</p>}
            />
            <DeployVersionDialog
                row={row}
                versions={versions}
                number={promoting}
                onOpenChange={(open) => !open && setPromoting(null)}
            />
            <ConfirmAction
                confirmation={confirmation}
                onOpenChange={(open) => !open && setConfirmation(null)}
            />
        </PanelSection>
    );
}

export function VersionsTab({
    row,
    detail,
    versions,
}: {
    row: ModelRow;
    detail: ModelDetail | undefined;
    versions: VersionInfo[];
}) {
    return (
        <>
            <ScoredBy detail={detail} />
            <PanelSections>
                <VersionsTable row={row} versions={versions} />
            </PanelSections>
        </>
    );
}
