import { Server } from "lucide-react";
import { Link } from "obp-ui";
import type { ReactNode } from "react";
import { PanelSection } from "~/components/Section";
import { BASIS_LABELS, GaugeLegend, UsageGauge, kindLegend } from "~/components/UsageGauge";
import { StatusText } from "~/components/models/StatusText";
import { kindNoun } from "~/lib/jobs";
import { modelPageHref } from "~/lib/modelLinks";
import { bytes, relativeTime } from "~/lib/time";
import {
    ENGINE_DOING,
    MEMORY_LABELS,
    type NodeJob,
    jobLink,
    jobSubject,
    memoryView,
    servedHref,
    versioned,
} from "./activity";
import { machineStatus } from "./machines";
import {
    MachineName,
    type NodeInfo,
    OnlineCount,
    type PoolInfo,
    type ReplicaInfo,
    RoomLine,
    fleetAnchor,
} from "./parts";

const LEGEND = kindLegend(["measured", "weights", "adapters", "training"]);

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
    const subject = jobSubject(job);
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
    const view = memoryView(node, engines);
    if (view === null) {
        return (
            <p className="text-sm text-muted-foreground">
                This machine has not reported its memory.
            </p>
        );
    }
    const { used, capacity, basis } = view;
    return (
        <div className="flex flex-col gap-1.5">
            <UsageGauge
                segments={view.segments}
                capacity={capacity}
                label={`${node.host} memory`}
                legend={false}
                basis={basis}
            />
            <p className="text-sm text-muted-foreground tabular-nums">
                {used > capacity ? (
                    <StatusText tone="destructive">{`${bytes(used)} planned, more than its ${bytes(capacity)}`}</StatusText>
                ) : (
                    `${bytes(used)} in use · ${bytes(capacity - used)} free · ${BASIS_LABELS[basis].toLowerCase()}`
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
    const draining = node.state === "draining";
    return (
        <li className="flex min-w-0 flex-col gap-2 px-4 py-3">
            <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                <span className="flex min-w-0 items-baseline gap-2">
                    <MachineName node={node} />
                    {draining && (
                        <span className="text-sm text-muted-foreground">
                            {machineStatus(node, engines).label}
                        </span>
                    )}
                </span>
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
                <span className="flex flex-wrap items-baseline gap-x-3 text-sm">
                    <RoomLine room={pool.room} />
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
            description="Every pool and what each machine is doing. Memory is measured where the machine reports it, else estimated from weight and adapter files and each training plan."
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
