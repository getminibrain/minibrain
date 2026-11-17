import { IconListDetails } from "@tabler/icons-react";
import { Link, cn } from "obp-ui";
import type { ReactNode } from "react";
import type { JobDetail, JobInfo, ModelRow, VersionInfo } from "~/api/client";
import { useAllModels, useVersionFiles } from "~/api/queries";
import { CopyButton } from "~/components/CopyButton";
import { PoolLink } from "~/components/PoolLink";
import { PanelSection } from "~/components/Section";
import { count } from "~/lib/format";
import { deviceHoursText, durationText, jobDuration } from "~/lib/jobs";
import { jobHref, modelPageHref, modelVersionHref } from "~/lib/modelLinks";
import { bytes } from "~/lib/time";
import { datasetHref } from "./about";
import { Tip, baseNameOf, isDeployed } from "./header";
import { VersionNote } from "./versionNote";
import { presetText, ranOn, useAvailableRows } from "./versionRun";
import {
    INVALID,
    type Measure,
    P95,
    changeOf,
    changeTone,
    costMeasure,
    mainMeasure,
    pendingText,
} from "./versionScore";
import type { Peers, Phase } from "./versionState";
import { DeployRuleFact } from "./versionVerdict";

const LINK = "truncate text-primary hover:underline";

function Muted({ children = "–" }: { children?: ReactNode }) {
    return <span className="truncate text-muted-foreground">{children}</span>;
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
    const change = changeOf(measure, mine, theirs);
    if (!change) {
        return null;
    }
    return (
        <span className="text-sm whitespace-nowrap">
            <span
                className={cn(
                    "tabular-nums",
                    changeTone(change.delta, change.text, measure.better),
                )}
            >
                {change.text}
            </span>
            <span className="text-muted-foreground">{` vs ${label}`}</span>
        </span>
    );
}

function Figure({
    measure,
    version,
    phase,
    peers,
    compared,
}: {
    measure: Measure;
    version: VersionInfo;
    phase: Phase;
    peers: Peers;
    compared: boolean;
}) {
    return (
        <div className="flex min-w-0 flex-col gap-0.5 px-panel py-3">
            <span className="truncate text-sm text-muted-foreground">{measure.label}</span>
            <span className="flex min-w-0 items-baseline gap-x-3">
                {phase === "ready" ? (
                    <span className="text-xl font-semibold tabular-nums">
                        {measure.text(version)}
                    </span>
                ) : (
                    <span className="text-xl text-muted-foreground">{pendingText(phase)}</span>
                )}
                {compared && phase === "ready" && (
                    <>
                        <Change measure={measure} mine={version} theirs={peers.live} label="live" />
                        <Change
                            measure={measure}
                            mine={version}
                            theirs={peers.zero}
                            label="baseline"
                        />
                    </>
                )}
            </span>
        </div>
    );
}

function Headline({
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
    const cost = costMeasure(versions);
    const figures = [INVALID, P95, ...(cost ? [cost] : [])];
    return (
        <div
            className={cn(
                "grid h-18 divide-x border-b",
                cost ? "grid-cols-[2fr_1fr_1fr_1fr]" : "grid-cols-[2fr_1fr_1fr]",
            )}
        >
            <Figure
                measure={mainMeasure(version)}
                version={version}
                phase={phase}
                peers={peers}
                compared
            />
            {figures.map((measure) => (
                <Figure
                    key={measure.id}
                    measure={measure}
                    version={version}
                    phase={phase}
                    peers={peers}
                    compared={false}
                />
            ))}
        </div>
    );
}

function FactList({ children }: { children: ReactNode }) {
    return (
        <dl className="grid grid-cols-[7.5rem_minmax(0,1fr)] content-start gap-x-4 gap-y-2 p-panel">
            {children}
        </dl>
    );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
    return (
        <div className="contents">
            <dt className="flex h-6 items-center text-muted-foreground">{label}</dt>
            <dd className="flex h-6 min-w-0 items-center gap-1">{children}</dd>
        </div>
    );
}

function methodText(version: VersionInfo): string {
    if (version.kind === "prompt") {
        return "Instructions only";
    }
    const recipe = version.recipe as { strategy?: string; rank?: number };
    const adapter = recipe.strategy === "qlora" ? "QLoRA" : "LoRA";
    return `SFT · ${adapter}${recipe.rank ? ` r${recipe.rank}` : ""}`;
}

function Settings({ version }: { version: VersionInfo }) {
    const available = useAvailableRows(version);
    const text =
        version.kind === "prompt"
            ? `${methodText(version)} · ${count(version.shots)} few-shot examples`
            : `${methodText(version)} · ${presetText(version, available)}`;
    return (
        <span className="truncate" title={text}>
            {text}
        </span>
    );
}

function MadeOf({
    row,
    version,
    baseName,
}: { row: ModelRow; version: VersionInfo; baseName: string }) {
    const baseKey = version.base_model || row.base_model || "";
    const copied = version.duplicated_from;
    const from = version.from_version;
    const data =
        version.dataset_version_number !== null && version.dataset_version_number !== undefined;
    return (
        <FactList>
            <Fact label="Note">
                <VersionNote slug={row.key} version={version} />
            </Fact>
            <Fact label="Base">
                {baseKey ? (
                    <Link href={modelPageHref(baseKey)} className={LINK}>
                        {baseName}
                    </Link>
                ) : (
                    <Muted />
                )}
            </Fact>
            <Fact label="Data">
                {data && version.dataset_slug ? (
                    <Link href={datasetHref(version.dataset_slug)} className={LINK}>
                        {`${version.dataset_slug} v${version.dataset_version_number}`}
                        <span className="text-muted-foreground tabular-nums">{` · ${count(version.dataset_version_rows)} rows`}</span>
                    </Link>
                ) : (
                    <Muted />
                )}
            </Fact>
            <Fact label="Started from">
                {from !== null && from !== undefined ? (
                    <Link href={modelVersionHref(row.key, from)} className={LINK}>
                        {`v${from}`}
                    </Link>
                ) : (
                    <Muted />
                )}
            </Fact>
            <Fact label="Copied from">
                {copied ? (
                    <Link href={modelVersionHref(copied.slug, copied.number)} className={LINK}>
                        {`${copied.name} v${copied.number}`}
                    </Link>
                ) : (
                    <Muted />
                )}
            </Fact>
            <Fact label="Settings">
                <Settings version={version} />
            </Fact>
        </FactList>
    );
}

function LiveFact({ row, peers }: { row: ModelRow; peers: Peers }) {
    const pool = row.deployment.pool;
    const where = pool ? (
        <>
            <span className="shrink-0 text-muted-foreground">on</span>
            <PoolLink name={pool} />
        </>
    ) : null;
    if (peers.isLive && isDeployed(row)) {
        return (
            <>
                <span className="shrink-0 text-success">This version</span>
                {where}
            </>
        );
    }
    if (!peers.live) {
        return <Muted />;
    }
    return (
        <>
            <Link href={modelVersionHref(row.key, peers.live.number)} className={LINK}>
                {`v${peers.live.number}`}
            </Link>
            {where}
        </>
    );
}

function JobFact({
    version,
    job,
    detail,
}: { version: VersionInfo; job: JobInfo | undefined; detail: JobDetail | undefined }) {
    if (!job) {
        return <Muted />;
    }
    const pool = ranOn(version, detail)?.pool;
    const took = jobDuration(job);
    return (
        <>
            <Link
                href={jobHref(job)}
                className="shrink-0 text-primary tabular-nums hover:underline"
            >
                {`Job #${job.id}`}
            </Link>
            {pool && (
                <>
                    <span className="shrink-0 text-muted-foreground">·</span>
                    <PoolLink name={pool} />
                </>
            )}
            {took !== "—" && (
                <span className="shrink-0 text-muted-foreground tabular-nums">{`· ${took}`}</span>
            )}
        </>
    );
}

function DeviceFact({ version }: { version: VersionInfo }) {
    const time = version.device_time;
    if (!time) {
        return <Muted />;
    }
    const devices = time.kind === "gpu" && time.devices > 1 ? ` on ${time.devices} GPUs` : "";
    const unit = time.kind === "cpu" ? " CPU-hours" : "";
    return (
        <span
            className="tabular-nums"
            title={`${durationText(time.seconds)} of wall time${devices}`}
        >
            {`${deviceHoursText(time)}${unit}`}
        </span>
    );
}

function AdapterFact({
    row,
    version,
    phase,
}: { row: ModelRow; version: VersionInfo; phase: Phase }) {
    const files = useVersionFiles(
        row.key,
        version.kind === "lora" && version.status === "ready" ? version.number : null,
    );
    const sha = files.data?.artifact_id;
    if (version.kind === "prompt") {
        return <Muted>None, prompt only</Muted>;
    }
    if (!sha) {
        return (
            <Muted>
                {phase === "failed" || phase === "cancelled" ? "–" : "Once training finishes"}
            </Muted>
        );
    }
    return (
        <>
            <Tip tip={sha}>
                <span className="cursor-default font-mono text-sm">{`sha256:${sha.slice(0, 12)}`}</span>
            </Tip>
            <span className="shrink-0 text-muted-foreground tabular-nums">{`· ${bytes(files.data?.size)}`}</span>
            <span className="-my-1.5">
                <CopyButton value={sha} label="Copy SHA-256" />
            </span>
        </>
    );
}

export function SummarySection({
    row,
    version,
    versions,
    phase,
    peers,
    job,
    detail,
}: {
    row: ModelRow;
    version: VersionInfo;
    versions: VersionInfo[];
    phase: Phase;
    peers: Peers;
    job: JobInfo | undefined;
    detail: JobDetail | undefined;
}) {
    const models = useAllModels();
    const callable = `${row.key}@${version.number}`;
    const baseName = baseNameOf(models.data, version.base_model || row.base_model);
    return (
        <PanelSection
            icon={IconListDetails}
            title="Summary"
            tip="Measured on held-out rows the version never trained on. Shares change in points."
            flush
        >
            <Headline version={version} versions={versions} phase={phase} peers={peers} />
            <div className="grid grid-cols-2 divide-x">
                <MadeOf row={row} version={version} baseName={baseName} />
                <FactList>
                    <Fact label="Deploy rule">
                        <DeployRuleFact row={row} version={version} phase={phase} peers={peers} />
                    </Fact>
                    <Fact label="Live">
                        <LiveFact row={row} peers={peers} />
                    </Fact>
                    <Fact label="Job">
                        <JobFact version={version} job={job} detail={detail} />
                    </Fact>
                    <Fact label="GPU-hours">
                        <DeviceFact version={version} />
                    </Fact>
                    <Fact label="API name">
                        <span className="truncate font-mono text-sm">{callable}</span>
                        <span className="-my-1.5">
                            <CopyButton value={callable} label={`Copy ${callable}`} />
                        </span>
                    </Fact>
                    <Fact label="Adapter">
                        <AdapterFact row={row} version={version} phase={phase} />
                    </Fact>
                </FactList>
            </div>
        </PanelSection>
    );
}
