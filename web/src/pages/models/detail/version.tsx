import { useQueryClient } from "@tanstack/react-query";
import { useParams, useRouter } from "@tanstack/react-router";
import {
    BookOpen,
    ChevronLeft,
    ChevronRight,
    Copy,
    Download,
    GitCompare,
    MoreHorizontal,
    Play,
    Trash2,
} from "lucide-react";
import {
    Badge,
    Button,
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
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
    cn,
    useToast,
} from "obp-ui";
import { useState } from "react";
import { type ModelRow, type VersionInfo, api, unwrap } from "~/api/client";
import { useDatasetVersions } from "~/api/dataQueries";
import { useJobMetrics } from "~/api/jobPageQueries";
import {
    isActiveJob,
    useAllModels,
    useJob,
    useJobs,
    useVersionFiles,
    useVersions,
} from "~/api/queries";
import { NotFoundState, QueryError } from "~/components/ErrorState";
import { PageCrumbs } from "~/components/PageCrumbs";
import { PageHeader } from "~/components/PageHeader";
import { Page, PanelSections } from "~/components/Section";
import { StatusText } from "~/components/models/StatusText";
import { useCan } from "~/lib/access";
import {
    modelCardHref,
    modelCompareHref,
    modelPageHref,
    modelVersionHref,
    versionNumberOf,
    versionPlaygroundHref,
} from "~/lib/modelLinks";
import { bytes, relativeTime } from "~/lib/time";
import { ConfirmAction, type Confirmation } from "../dialogs";
import { Tip, baseNameOf, isDeployed, modelCrumbs } from "./header";
import { DeployVersionDialog, liveBlock, versionLabel } from "./makeLive";
import { ChangesSection } from "./versionChanges";
import { DetailsSection, LineageSection, TrainingSection } from "./versionRun";
import { ScoreSection } from "./versionScore";
import { type Peers, type Phase, peersOf, phaseOf, verdictLine } from "./versionState";
import { VersionStatus, runJob } from "./versions";

function artifactHref(id: string): string {
    return `/api/artifacts/${id}`;
}

const FORMATS = [
    {
        id: "adapter",
        label: "Adapter only",
        file: "safetensors",
        runs: "Loads on the same base in minibrain, vLLM or PEFT.",
        ready: true,
    },
    {
        id: "merged",
        label: "Merged full model",
        file: "safetensors",
        runs: "The base with the adapter folded in; runs on any server for Hugging Face models.",
        ready: false,
    },
    {
        id: "gguf",
        label: "Merged and quantised GGUF",
        file: "GGUF",
        runs: "For llama.cpp or Ollama, on a laptop or CPU server.",
        ready: false,
    },
];

function ExportDialog({
    row,
    version,
    open,
    onOpenChange,
}: {
    row: ModelRow;
    version: VersionInfo;
    open: boolean;
    onOpenChange: (open: boolean) => void;
}) {
    const files = useVersionFiles(row.key, open ? version.number : null);
    const sha = files.data?.artifact_id;
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-xl">
                <DialogHeader>
                    <DialogTitle>{`Export v${version.number}`}</DialogTitle>
                    <DialogDescription>
                        {`Files of ${row.name} v${version.number} you can run elsewhere. Each carries its SHA-256.`}
                    </DialogDescription>
                </DialogHeader>
                <ul className="flex flex-col divide-y rounded-md border">
                    {FORMATS.map((item) => (
                        <li key={item.id} className="flex flex-wrap items-center gap-3 px-3 py-3">
                            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                                <span className="flex flex-wrap items-baseline gap-x-3">
                                    <span
                                        className={cn(
                                            "font-medium",
                                            !item.ready && "text-muted-foreground",
                                        )}
                                    >
                                        {item.label}
                                    </span>
                                    <span className="text-sm text-muted-foreground">
                                        {item.ready && files.data
                                            ? `${item.file} · ${bytes(files.data.size)}`
                                            : item.file}
                                    </span>
                                </span>
                                <span className="text-sm text-muted-foreground">{item.runs}</span>
                            </span>
                            {item.ready ? (
                                <Button variant="outline" disabled={!sha} asChild={Boolean(sha)}>
                                    {sha ? (
                                        <a href={artifactHref(sha)} download>
                                            <Download aria-hidden="true" />
                                            Download
                                        </a>
                                    ) : (
                                        "Download"
                                    )}
                                </Button>
                            ) : (
                                <Badge variant="neutral">Coming soon</Badge>
                            )}
                        </li>
                    ))}
                </ul>
                <DialogFooter>
                    <Button onClick={() => onOpenChange(false)}>Done</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

function copyText(value: string): Promise<void> {
    return navigator.clipboard
        ? navigator.clipboard.writeText(value)
        : Promise.reject(new Error("blocked"));
}

function VersionMenu({
    row,
    versions,
    version,
}: { row: ModelRow; versions: VersionInfo[]; version: VersionInfo }) {
    const router = useRouter();
    const toast = useToast();
    const can = useCan();
    const client = useQueryClient();
    const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
    const [exporting, setExporting] = useState(false);
    const callable = `${row.key}@${version.number}`;
    const ready = version.status === "ready";
    const exportable = ready && version.kind === "lora";
    const isLive = isDeployed(row) && row.current_version === version.number;
    const baseline = version.number === 0;
    const others = versions
        .filter((item) => item.number !== version.number && item.status === "ready")
        .sort((a, b) => b.number - a.number);
    const remove = () =>
        setConfirmation({
            title: `Delete ${versionLabel(version)} of ${row.name}?`,
            description: (
                <p>{`${callable} stops answering and its adapter, scores and card are removed.`}</p>
            ),
            confirmLabel: "Delete version",
            destructive: true,
            run: async () => {
                await unwrap(
                    api.DELETE("/api/models/{name}/versions/{number}", {
                        params: {
                            path: { name: row.key, number: version.number },
                            query: { cancel_jobs: true },
                        },
                    }),
                );
                await client.invalidateQueries();
                toast({ title: `Deleted v${version.number}`, tone: "success" });
                router.history.push(modelPageHref(row.key, "versions"));
            },
        });
    return (
        <>
            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <Button
                        variant="outline"
                        size="icon"
                        aria-label={`More actions for v${version.number}`}
                    >
                        <MoreHorizontal />
                    </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-60">
                    <DropdownMenuItem
                        disabled={!ready}
                        onSelect={() =>
                            router.history.push(versionPlaygroundHref(row.key, version.number))
                        }
                    >
                        <Play />
                        Try in Playground
                    </DropdownMenuItem>
                    <DropdownMenuSub>
                        <DropdownMenuSubTrigger disabled={!ready || others.length === 0}>
                            <GitCompare />
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
                                            Live
                                        </span>
                                    )}
                                </DropdownMenuItem>
                            ))}
                        </DropdownMenuSubContent>
                    </DropdownMenuSub>
                    <DropdownMenuItem
                        onSelect={() =>
                            copyText(callable).then(
                                () => toast({ title: `Copied ${callable}` }),
                                () => toast({ title: "This browser blocks copying here" }),
                            )
                        }
                    >
                        <Copy />
                        <span>
                            Copy <span className="font-mono">{callable}</span>
                        </span>
                    </DropdownMenuItem>
                    <DropdownMenuItem
                        onSelect={() => router.history.push(modelCardHref(row.key, version.number))}
                    >
                        <BookOpen />
                        Model card
                    </DropdownMenuItem>
                    <DropdownMenuItem
                        disabled={!exportable || !can.build}
                        className={exportable ? undefined : "items-start"}
                        onSelect={() => setExporting(true)}
                    >
                        <Download className={exportable ? undefined : "mt-0.5"} />
                        <span className="flex flex-col">
                            <span>Export…</span>
                            {!exportable && (
                                <span className="text-sm whitespace-normal text-muted-foreground">
                                    {version.kind === "prompt"
                                        ? "A prompt-only version has no weights of its own."
                                        : "Only a ready version can be exported."}
                                </span>
                            )}
                        </span>
                    </DropdownMenuItem>
                    {can.build && (
                        <>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                                variant="destructive"
                                disabled={isLive || baseline}
                                onSelect={remove}
                            >
                                <Trash2 />
                                {baseline
                                    ? "Delete version (v0 is the baseline)"
                                    : isLive
                                      ? "Delete version (live)"
                                      : "Delete version"}
                            </DropdownMenuItem>
                        </>
                    )}
                </DropdownMenuContent>
            </DropdownMenu>
            <ConfirmAction
                confirmation={confirmation}
                onOpenChange={(open) => !open && setConfirmation(null)}
            />
            <ExportDialog
                row={row}
                version={version}
                open={exporting}
                onOpenChange={setExporting}
            />
        </>
    );
}

function deployReason(
    row: ModelRow,
    version: VersionInfo,
    phase: Phase,
    peers: Peers,
    builder: boolean,
): string | null {
    if (!builder) {
        return "You need build access to deploy.";
    }
    if (peers.isLive && isDeployed(row)) {
        return `v${version.number} is already live.`;
    }
    if (phase === "queued" || phase === "training") {
        return `v${version.number} is still training; it can be deployed once it is scored.`;
    }
    if (phase === "scoring") {
        return `v${version.number} is still being scored; it can be deployed once it is scored.`;
    }
    if (phase === "failed") {
        return `v${version.number} failed, so there is nothing to deploy.`;
    }
    if (phase === "cancelled") {
        return `v${version.number} was cancelled before it finished, so there is nothing to deploy.`;
    }
    return liveBlock(row, version);
}

function DeployButton({
    row,
    versions,
    version,
    phase,
    peers,
}: { row: ModelRow; versions: VersionInfo[]; version: VersionInfo; phase: Phase; peers: Peers }) {
    const can = useCan();
    const [open, setOpen] = useState(false);
    const blocked = deployReason(row, version, phase, peers, can.build);
    return (
        <>
            <Tip tip={blocked}>
                <Button disabled={Boolean(blocked)} onClick={() => setOpen(true)}>
                    {`Deploy v${version.number}`}
                </Button>
            </Tip>
            {!blocked && (
                <DeployVersionDialog
                    row={row}
                    versions={versions}
                    number={open ? version.number : null}
                    onOpenChange={setOpen}
                />
            )}
        </>
    );
}

function useHeldOutRows(version: VersionInfo, enabled: boolean): number | null {
    const data = useDatasetVersions(version.dataset_slug ?? "", enabled);
    const found = data.data?.find((item) => item.id === version.dataset_version_id);
    return found?.counts.eval ?? null;
}

function VerdictLine({
    version,
    phase,
    peers,
    eta,
}: { version: VersionInfo; phase: Phase; peers: Peers; eta: number | null | undefined }) {
    const rows = useHeldOutRows(version, phase === "scoring");
    const verdict = verdictLine({ version, phase, peers, eta, heldOutRows: rows });
    return (
        <p className="flex min-h-6 min-w-0 items-center" aria-live="polite">
            <StatusText tone={verdict.tone} className="min-w-0">
                <span className="truncate tabular-nums" title={verdict.text}>
                    {verdict.text}
                </span>
            </StatusText>
        </p>
    );
}

function neighbours(
    versions: VersionInfo[],
    number: number,
): { previous: number | null; next: number | null } {
    const numbers = versions
        .filter((item) => item.status !== "deleting")
        .map((item) => item.number);
    const before = numbers.filter((item) => item < number);
    const after = numbers.filter((item) => item > number);
    return {
        previous: before.length > 0 ? Math.max(...before) : null,
        next: after.length > 0 ? Math.min(...after) : null,
    };
}

function StepLink({
    slug,
    number,
    direction,
}: { slug: string; number: number | null; direction: "previous" | "next" }) {
    const Icon = direction === "previous" ? ChevronLeft : ChevronRight;
    const word = direction === "previous" ? "Previous" : "Next";
    if (number === null) {
        return (
            <Button
                variant="ghost"
                size="icon-sm"
                disabled
                aria-label={`No ${word.toLowerCase()} version`}
            >
                <Icon />
            </Button>
        );
    }
    const label = `v${number}`;
    return (
        <Tooltip>
            <TooltipTrigger asChild>
                <Button variant="ghost" size="sm" asChild>
                    <Link
                        href={modelVersionHref(slug, number)}
                        aria-label={`${word} version ${label}`}
                        className="tabular-nums"
                    >
                        {direction === "previous" && <Icon aria-hidden="true" />}
                        {label}
                        {direction === "next" && <Icon aria-hidden="true" />}
                    </Link>
                </Button>
            </TooltipTrigger>
            <TooltipContent>{`${word} version ${label}`}</TooltipContent>
        </Tooltip>
    );
}

function VersionStepper({
    slug,
    versions,
    number,
}: { slug: string; versions: VersionInfo[]; number: number }) {
    const { previous, next } = neighbours(versions, number);
    return (
        <nav aria-label="Other versions" className="flex items-center text-muted-foreground">
            <StepLink slug={slug} number={previous} direction="previous" />
            <span aria-hidden="true">·</span>
            <StepLink slug={slug} number={next} direction="next" />
        </nav>
    );
}

export function VersionView({ row, number }: { row: ModelRow; number: number | null }) {
    const models = useAllModels();
    const versions = useVersions(row.key);
    const jobs = useJobs(row.key);
    const list = versions.data ?? [];
    const version = list.find((item) => item.number === number);
    const run = version ? runJob(version, jobs.data ?? []) : undefined;
    const runDetail = useJob(run?.id ?? null);
    const detail = runDetail.data;
    const trained = run?.kind === "train";
    const metrics = useJobMetrics(run?.id ?? 0, Boolean(detail && isActiveJob(detail)), trained);
    const crumbs = modelCrumbs(row, [
        { label: "Versions", href: modelPageHref(row.key, "versions") },
    ]);
    if (!version) {
        return (
            <Page wide>
                <PageCrumbs items={crumbs} />
                {versions.isLoading ? (
                    <p className="text-muted-foreground">Loading…</p>
                ) : versions.error ? (
                    <QueryError error={versions.error} retry={versions.refetch} />
                ) : (
                    <NotFoundState
                        title="Version not found"
                        primary={{
                            label: "Go to Versions",
                            href: modelPageHref(row.key, "versions"),
                        }}
                        secondary={{ label: `Go to ${row.name}`, href: modelPageHref(row.key) }}
                    >
                        {number !== null
                            ? `${row.name} has no v${number}. It may have been deleted.`
                            : `${row.name} has no version with that number.`}
                    </NotFoundState>
                )}
            </Page>
        );
    }
    const phase = phaseOf(version);
    const peers = peersOf(row, list, version);
    const base = baseNameOf(models.data, version.base_model || row.base_model);
    const trainMetrics = trained ? metrics.data : undefined;
    return (
        <Page wide>
            <PageHeader
                title={versionLabel(version)}
                crumbs={crumbs}
                badge={
                    <span className="flex items-center gap-3">
                        <VersionStepper slug={row.key} versions={list} number={version.number} />
                        <VersionStatus row={row} version={version} />
                    </span>
                }
                caption={`${row.name} on ${base} · created ${relativeTime(version.created_at)}`}
                actions={
                    <>
                        <DeployButton
                            row={row}
                            versions={list}
                            version={version}
                            phase={phase}
                            peers={peers}
                        />
                        <VersionMenu row={row} versions={list} version={version} />
                    </>
                }
            />
            <VerdictLine
                version={version}
                phase={phase}
                peers={peers}
                eta={trainMetrics?.training?.eta_seconds}
            />
            <PanelSections>
                <ScoreSection version={version} versions={list} phase={phase} peers={peers} />
                <ChangesSection slug={row.key} version={version} phase={phase} peers={peers} />
                <TrainingSection
                    slug={row.key}
                    versions={list}
                    version={version}
                    phase={phase}
                    peers={peers}
                    run={run}
                    detail={trained ? detail : undefined}
                    metrics={trainMetrics}
                    metricsError={trained ? metrics.error : null}
                    onRetry={metrics.refetch}
                />
                <LineageSection row={row} version={version} peers={peers} />
                <DetailsSection row={row} version={version} phase={phase} />
            </PanelSections>
        </Page>
    );
}

export function useVersionNumber(): number | null {
    const { number } = useParams({ strict: false }) as { number?: string };
    return versionNumberOf(number);
}
