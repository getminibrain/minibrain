import {
    IconBook,
    IconChevronDown,
    IconCopy,
    IconDots,
    IconDownload,
    IconGitCompare,
    IconPlayerPlay,
    IconTrash,
} from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import { useParams, useRouter } from "@tanstack/react-router";
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
    DropdownMenuRadioGroup,
    DropdownMenuRadioItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
    Link,
    cn,
    useToast,
} from "obp-ui";
import { useState } from "react";
import { type ModelRow, type VersionInfo, api, unwrap } from "~/api/client";
import { useJobMetrics } from "~/api/jobPageQueries";
import { isActiveJob, useJob, useJobs, useVersionFiles, useVersions } from "~/api/queries";
import { NotFoundState, QueryError } from "~/components/ErrorState";
import { PageCrumbs } from "~/components/PageCrumbs";
import { PageHeader } from "~/components/PageHeader";
import { Page, PanelSections } from "~/components/Section";
import { useCan } from "~/lib/access";
import { percent } from "~/lib/format";
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
import { Tip, isDeployed, modelCrumbs } from "./header";
import { DeployVersionDialog, liveBlock, versionLabel } from "./makeLive";
import { EvaluationSection } from "./versionEvaluation";
import { VersionNote } from "./versionNote";
import { TrainingSection } from "./versionRun";
import { type Peers, type Phase, peersOf, phaseOf } from "./versionState";
import { SummarySection } from "./versionSummary";
import { VerdictLine } from "./versionVerdict";
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
                                            <IconDownload aria-hidden="true" />
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

function shown(versions: VersionInfo[]): VersionInfo[] {
    return versions
        .filter((item) => item.status !== "deleting")
        .sort((a, b) => b.number - a.number);
}

function compareTarget(
    row: ModelRow,
    versions: VersionInfo[],
    version: VersionInfo,
): number | null {
    const others = shown(versions).filter(
        (item) => item.number !== version.number && item.status === "ready",
    );
    const live = isDeployed(row) ? others.find((item) => item.current) : undefined;
    const older = others.find((item) => item.number < version.number);
    return (live ?? older ?? others[0])?.number ?? null;
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
    const other = compareTarget(row, versions, version);
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
                        <IconDots />
                    </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-60">
                    <DropdownMenuItem
                        disabled={!ready}
                        onSelect={() =>
                            router.history.push(versionPlaygroundHref(row.key, version.number))
                        }
                    >
                        <IconPlayerPlay />
                        Try in Playground
                    </DropdownMenuItem>
                    <DropdownMenuItem
                        disabled={other === null}
                        onSelect={() =>
                            other !== null &&
                            router.history.push(modelCompareHref(row.key, other, version.number))
                        }
                    >
                        <IconGitCompare />
                        Compare with…
                    </DropdownMenuItem>
                    <DropdownMenuItem
                        onSelect={() =>
                            copyText(callable).then(
                                () => toast({ title: `Copied ${callable}` }),
                                () => toast({ title: "This browser blocks copying here" }),
                            )
                        }
                    >
                        <IconCopy />
                        <span>
                            Copy <span className="font-mono">{callable}</span>
                        </span>
                    </DropdownMenuItem>
                    <DropdownMenuItem
                        onSelect={() => router.history.push(modelCardHref(row.key, version.number))}
                    >
                        <IconBook />
                        Model card
                    </DropdownMenuItem>
                    <DropdownMenuItem
                        disabled={!exportable || !can.build}
                        className={exportable ? undefined : "items-start"}
                        onSelect={() => setExporting(true)}
                    >
                        <IconDownload className={exportable ? undefined : "mt-0.5"} />
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
                                <IconTrash />
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

function VersionPicker({
    row,
    versions,
    version,
}: { row: ModelRow; versions: VersionInfo[]; version: VersionInfo }) {
    const router = useRouter();
    const live = isDeployed(row) ? row.current_version : null;
    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button variant="outline" aria-label={`Version v${version.number}, pick another`}>
                    <span className="tabular-nums">{`v${version.number}`}</span>
                    <IconChevronDown aria-hidden="true" />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="max-h-96 w-64">
                <DropdownMenuRadioGroup
                    value={String(version.number)}
                    onValueChange={(value) =>
                        router.history.push(modelVersionHref(row.key, Number(value)))
                    }
                >
                    {shown(versions).map((item) => (
                        <DropdownMenuRadioItem key={item.number} value={String(item.number)}>
                            <span className="tabular-nums">{versionLabel(item)}</span>
                            <span className="ml-auto flex items-center gap-2 text-sm text-muted-foreground tabular-nums">
                                {item.number === live && <span className="text-success">Live</span>}
                                {item.score === null ? "–" : percent(item.score)}
                            </span>
                        </DropdownMenuRadioItem>
                    ))}
                </DropdownMenuRadioGroup>
            </DropdownMenuContent>
        </DropdownMenu>
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

function captionOf(version: VersionInfo): string {
    const kind =
        version.kind === "lora"
            ? "Trained"
            : version.number === 0
              ? "Baseline, prompt only"
              : "Prompt only";
    return `${kind} · created ${relativeTime(version.created_at)}`;
}

export function VersionView({ row, number }: { row: ModelRow; number: number | null }) {
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
    const trainMetrics = trained ? metrics.data : undefined;
    const active = version.job && isActiveJob(version.job) ? version.job : undefined;
    return (
        <Page wide>
            <PageHeader
                title={`${row.name} v${version.number}`}
                crumbs={crumbs}
                badge={<VersionStatus row={row} version={version} />}
                caption={captionOf(version)}
                actions={
                    <>
                        <VersionPicker row={row} versions={list} version={version} />
                        <Button variant="outline" asChild>
                            <Link href={modelCardHref(row.key, version.number)}>Model card</Link>
                        </Button>
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
            <div className="flex flex-col gap-1">
                <VerdictLine
                    row={row}
                    version={version}
                    phase={phase}
                    peers={peers}
                    eta={trainMetrics?.training?.eta_seconds}
                />
                <VersionNote slug={row.key} version={version} />
            </div>
            <PanelSections>
                <SummarySection
                    row={row}
                    version={version}
                    versions={list}
                    phase={phase}
                    peers={peers}
                    job={active ?? run}
                    detail={detail}
                />
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
                <EvaluationSection
                    slug={row.key}
                    version={version}
                    versions={list}
                    phase={phase}
                    peers={peers}
                />
            </PanelSections>
        </Page>
    );
}

export function useVersionNumber(): number | null {
    const { number } = useParams({ strict: false }) as { number?: string };
    return versionNumberOf(number);
}
