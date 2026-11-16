import { Server } from "lucide-react";
import { Link } from "obp-ui";
import type { ReactNode } from "react";
import { PanelSection } from "~/components/Section";
import { GaugeLegend, type GaugeSegment, UsageGauge, kindLegend } from "~/components/UsageGauge";
import { StatusText } from "~/components/models/StatusText";
import { kindNoun } from "~/lib/jobs";
import { jobHref, modelPageHref, modelVersionHref } from "~/lib/modelLinks";
import { bytes, relativeTime } from "~/lib/time";
import {
    MachineName,
    type NodeInfo,
    OnlineCount,
    type PoolInfo,
    type ReplicaInfo,
    fleetAnchor,
} from "./parts";

type NodeJob = NodeInfo["jobs"][number];
type Served = ReplicaInfo["serves"][number];

const LEGEND = kindLegend(["weights", "adapters", "training"]);

const MEMORY_LABELS: Record<string, string> = {
    cuda: "GPU memory",
    rocm: "GPU memory",
    xpu: "GPU memory",
    mps: "unified memory",
};

function versioned(name: string, version: number | null | undefined): string {
    return version === null || version === undefined ? name : `${name} v${version}`;
}

function servedHref(served: Served): string {
    return served.version === null || served.version === undefined
        ? modelPageHref(served.model)
        : modelVersionHref(served.model, served.version);
}

function jobLink(job: NodeJob): string {
    if (job.kind === "train" && job.model && job.version !== null && job.version !== undefined) {
        return modelVersionHref(job.model, job.version);
    }
    return jobHref(job);
}

function memorySegments(node: NodeInfo, engines: ReplicaInfo[]): GaugeSegment[] {
    const served = engines
        .filter((engine) => engine.state !== "failed")
        .flatMap((engine) => [
            {
                key: `weights-${engine.id}`,
                label: `${engine.base_model} weights`,
                kind: "weights" as const,
                bytes: engine.weights_bytes ?? 0,
            },
            ...engine.serves
                .filter((item) => item.adapter_bytes)
                .map((item) => ({
                    key: `adapter-${engine.id}-${item.model}`,
                    label: `${versioned(item.name, item.version)} adapter`,
                    kind: "adapters" as const,
                    bytes: item.adapter_bytes ?? 0,
                })),
        ]);
    const training = node.jobs
        .filter((job) => job.memory_bytes)
        .map((job) => ({
            key: `job-${job.id}`,
            label: `Training ${versioned(job.model_name ?? job.model ?? `job ${job.id}`, job.version)}`,
            kind: "training" as const,
            bytes: job.memory_bytes ?? 0,
        }));
    return [...served, ...training];
}

const ENGINE_DOING: Record<string, string> = {
    loading: "Loading",
    fetching: "Fetching weights for",
    failed: "Engine failed for",
};

function EngineActivity({ engine }: { engine: ReplicaInfo }) {
    const verb = ENGINE_DOING[engine.state] ?? "Serving";
    const tone =
        engine.state === "failed" ? "destructive" : engine.state === "ready" ? "success" : "info";
    const targets: ReactNode[] =
        engine.serves.length > 0
            ? engine.serves.map((served) => (
                  <Link
                      key={served.model}
                      href={servedHref(served)}
                      className="text-primary hover:underline"
                  >
                      {versioned(served.name, served.version)}
                  </Link>
              ))
            : [
                  <Link
                      key={engine.base_model}
                      href={modelPageHref(engine.base_model)}
                      className="font-mono text-primary hover:underline"
                  >
                      {engine.base_model}
                  </Link>,
              ];
    return (
        <li className="flex min-w-0 flex-wrap items-baseline gap-x-1">
            <StatusText tone={tone}>{verb}</StatusText>
            {targets.map((target, index) => (
                <span key={String(index)}>
                    {target}
                    {index < targets.length - 1 && ","}
                </span>
            ))}
        </li>
    );
}

function JobActivity({ job }: { job: NodeJob }) {
    const subject = versioned(job.model_name ?? job.model ?? `job ${job.id}`, job.version);
    return (
        <li className="flex min-w-0 flex-wrap items-baseline gap-x-1">
            <StatusText tone="info">{kindNoun(job.kind)}</StatusText>
            <Link href={jobLink(job)} className="text-primary hover:underline">
                {subject}
            </Link>
            <span className="text-muted-foreground tabular-nums">{`· ${Math.round(job.progress * 100)}%`}</span>
        </li>
    );
}

function MemoryLine({ node, engines }: { node: NodeInfo; engines: ReplicaInfo[] }) {
    const total = node.usable_bytes;
    if (total === null || total === undefined || total <= 0) {
        return (
            <p className="text-sm text-muted-foreground">
                This machine has not reported its memory.
            </p>
        );
    }
    const segments = memorySegments(node, engines);
    const used = segments.reduce((sum, segment) => sum + segment.bytes, 0);
    const over = used > total;
    return (
        <div className="flex flex-col gap-1.5">
            <UsageGauge
                segments={segments}
                capacity={total}
                label={`${node.host} memory`}
                legend={false}
            />
            <p className="text-sm text-muted-foreground tabular-nums">
                {over ? (
                    <StatusText tone="destructive">{`${bytes(used)} planned, more than its ${bytes(total)}`}</StatusText>
                ) : (
                    `${bytes(used)} in use · ${bytes(total - used)} free`
                )}
            </p>
        </div>
    );
}

function MachineTile({ node, engines }: { node: NodeInfo; engines: ReplicaInfo[] }) {
    const hardware = [
        node.accelerator_name || node.accelerator,
        node.usable_bytes
            ? `${bytes(node.usable_bytes)} ${MEMORY_LABELS[node.accelerator] ?? "RAM"}`
            : null,
    ]
        .filter(Boolean)
        .join(" · ");
    const busy = engines.length > 0 || node.jobs.length > 0;
    return (
        <li className="flex min-w-0 flex-col gap-2 px-4 py-3">
            <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                <MachineName node={node} />
                <span className="min-w-0 truncate text-sm text-muted-foreground tabular-nums">
                    {hardware}
                </span>
            </div>
            {node.online ? (
                <>
                    <MemoryLine node={node} engines={engines} />
                    {busy ? (
                        <ul className="flex flex-col gap-0.5">
                            {engines.map((engine) => (
                                <EngineActivity key={engine.id} engine={engine} />
                            ))}
                            {node.jobs.map((job) => (
                                <JobActivity key={job.id} job={job} />
                            ))}
                        </ul>
                    ) : (
                        <p className="text-muted-foreground">Idle</p>
                    )}
                </>
            ) : (
                <p className="text-muted-foreground">
                    {`Offline · last seen ${node.seen_at ? relativeTime(node.seen_at) : "never"}`}
                </p>
            )}
        </li>
    );
}

function PoolCard({ pool }: { pool: PoolInfo }) {
    return (
        <section
            id={fleetAnchor(pool.name)}
            aria-label={`Pool ${pool.name}`}
            className="flex min-w-0 scroll-mt-20 flex-col rounded-lg border bg-card"
        >
            <header className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b px-4 py-3">
                <span className="flex min-w-0 items-baseline gap-2">
                    <h3 className="truncate text-base font-medium">{pool.name}</h3>
                    {pool.label !== pool.name && (
                        <span className="truncate text-sm text-muted-foreground">{pool.label}</span>
                    )}
                </span>
                <span className="text-sm">
                    <OnlineCount nodes={pool.nodes} />
                </span>
            </header>
            {pool.nodes.length === 0 ? (
                <p className="px-4 py-3 text-muted-foreground">No machine has joined yet.</p>
            ) : (
                <ul className="flex flex-col divide-y">
                    {pool.nodes.map((node) => (
                        <MachineTile
                            key={node.id}
                            node={node}
                            engines={pool.engines.filter((engine) => engine.host === node.host)}
                        />
                    ))}
                </ul>
            )}
        </section>
    );
}

export function FleetBoard({ pools }: { pools: PoolInfo[] }) {
    return (
        <PanelSection
            bare
            icon={Server}
            title="Machines"
            description="Every pool and what each machine is doing. Memory is estimated from weight and adapter files and each training plan."
        >
            <div className="flex flex-col gap-3">
                <GaugeLegend items={LEGEND} />
                <div className="grid items-start gap-4 lg:grid-cols-2">
                    {pools.map((pool) => (
                        <PoolCard key={pool.name} pool={pool} />
                    ))}
                </div>
            </div>
        </PanelSection>
    );
}
