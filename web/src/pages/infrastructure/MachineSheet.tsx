import {
    Collapsible,
    CollapsibleContent,
    CollapsibleTrigger,
    Link,
    Sheet,
    SheetContent,
    SheetDescription,
    SheetHeader,
    SheetTitle,
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "obp-ui";
import { type ReactNode, useRef } from "react";
import type { Problem } from "~/api/problemQueries";
import { Facts } from "~/components/Facts";
import { PoolLink } from "~/components/PoolLink";
import { UsageGauge } from "~/components/UsageGauge";
import { When } from "~/components/When";
import { StatusText, type Tone, percentOf } from "~/components/models/StatusText";
import { count } from "~/lib/format";
import { kindNoun } from "~/lib/jobs";
import { jobHref } from "~/lib/modelLinks";
import { bytes, exactTime, relativeTime } from "~/lib/time";
import { MachineActions } from "./MachineActions";
import { LiveMetrics } from "./MachineLive";
import {
    MEMORY_LABELS,
    type MemoryView,
    engineLabel,
    engineState,
    estimatedView,
    jobLink,
    jobSubject,
    measuredView,
    servedHref,
    versioned,
} from "./activity";
import { RestartFix } from "./commands";
import { type MachineRow, hardwareText, machineStatus, versionDrift } from "./machines";
import type { InfrastructureInfo, NodeInfo, ReplicaInfo } from "./parts";

const OUTCOMES: Record<string, { label: string; tone: Tone }> = {
    succeeded: { label: "Done", tone: "success" },
    failed: { label: "Failed", tone: "destructive" },
    lost: { label: "Lost", tone: "warning" },
    cancelled: { label: "Cancelled", tone: "neutral" },
};

const LINK = "text-primary hover:underline";

export function Block({ title, children }: { title: string; children: ReactNode }) {
    return (
        <section className="flex min-w-0 flex-col gap-3 border-t pt-5">
            <h3 className="text-base font-medium">{title}</h3>
            {children}
        </section>
    );
}

function Muted({ children }: { children: ReactNode }) {
    return <p className="text-muted-foreground">{children}</p>;
}

function machineDiskFacts(node: NodeInfo): [string, ReactNode][] {
    return (node.disks ?? [])
        .filter(
            (disk) => disk.total_bytes && disk.free_bytes !== null && disk.free_bytes !== undefined,
        )
        .map((disk) => [
            `Disk ${disk.mount ?? disk.path}`,
            <span key={disk.path} className="tabular-nums">
                {`${bytes(disk.free_bytes)} free of ${bytes(disk.total_bytes)} · minibrain keeps ${bytes(disk.minibrain_bytes)}`}
            </span>,
        ]);
}

function diskFacts(row: MachineRow, info: InfrastructureInfo | undefined): [string, ReactNode][] {
    if (!row.node.roles.includes("main")) {
        return machineDiskFacts(row.node);
    }
    const disks = new Map<string, NonNullable<InfrastructureInfo["stores"]>[number]>();
    for (const store of info?.stores ?? []) {
        if (store.total_bytes && store.free_bytes !== null && store.free_bytes !== undefined) {
            disks.set(store.disk ?? store.name, store);
        }
    }
    return [...disks.values()].map((store) => [
        store.mount ? `Disk ${store.mount}` : `Disk for ${store.name}`,
        <span key={store.name} className="tabular-nums">
            {`${bytes(store.free_bytes)} free of ${bytes(store.total_bytes)}`}
        </span>,
    ]);
}

function HardwareBlock({ row, info }: { row: MachineRow; info: InfrastructureInfo | undefined }) {
    const { node } = row;
    const gpus: [string, ReactNode][] = node.gpus.map((gpu, index) => [
        node.gpus.length > 1 ? `GPU ${index}` : "GPU",
        <span
            key={String(index)}
            className="tabular-nums"
        >{`${gpu.name} · ${bytes(gpu.memory_bytes)}`}</span>,
    ]);
    return (
        <Block title="Hardware">
            <Facts
                items={[
                    ...gpus,
                    [
                        "Memory for models",
                        <span key="usable" className="tabular-nums">
                            {node.usable_bytes
                                ? `${bytes(node.usable_bytes)} ${MEMORY_LABELS[node.accelerator] ?? "RAM"}`
                                : "Not reported"}
                        </span>,
                    ],
                    [
                        "CPU",
                        <span key="cpu" className="tabular-nums">
                            {[`${count(node.cpu_count)} cores`, node.system, node.arch]
                                .filter(Boolean)
                                .join(" · ")}
                        </span>,
                    ],
                    [
                        "RAM",
                        <span key="ram" className="tabular-nums">
                            {node.ram_bytes ? bytes(node.ram_bytes) : "Not reported"}
                        </span>,
                    ],
                    ...diskFacts(row, info),
                    [
                        "Engines installed",
                        node.engines.length > 0
                            ? node.engines.map(engineLabel).join(", ")
                            : "None reported",
                    ],
                ]}
            />
        </Block>
    );
}

function MachineState({ row }: { row: MachineRow }) {
    const status = machineStatus(row.node, row.engines);
    return (
        <StatusText tone={status.tone} active={status.active}>
            {status.label}
        </StatusText>
    );
}

function EngineItem({ engine }: { engine: ReplicaInfo }) {
    const state = engineState(engine.state);
    return (
        <li className="flex min-w-0 flex-col gap-1 py-2">
            <span className="flex flex-wrap items-baseline justify-between gap-x-3">
                <span className="flex items-baseline gap-2">
                    <span className="font-medium">{engineLabel(engine.engine)}</span>
                    <StatusText tone={state.tone} active={state.tone === "info"}>
                        {state.label}
                    </StatusText>
                </span>
                <span className="text-sm text-muted-foreground tabular-nums">
                    {`${bytes(engine.weights_bytes)} weights`}
                </span>
            </span>
            <span className="truncate font-mono text-sm text-muted-foreground">
                {engine.base_model}
            </span>
            {engine.serves.length > 0 && (
                <ul className="flex flex-col gap-0.5">
                    {engine.serves.map((served) => (
                        <li
                            key={served.model}
                            className="flex flex-wrap items-baseline justify-between gap-x-3"
                        >
                            <Link href={servedHref(served)} className={LINK}>
                                {versioned(served.name, served.version)}
                            </Link>
                            {served.adapter_bytes ? (
                                <span className="text-sm text-muted-foreground tabular-nums">
                                    {`${bytes(served.adapter_bytes)} adapter`}
                                </span>
                            ) : null}
                        </li>
                    ))}
                </ul>
            )}
        </li>
    );
}

function MemoryGauge({ view, host }: { view: MemoryView | null; host: string }) {
    if (view === null) {
        return null;
    }
    return (
        <UsageGauge
            segments={view.segments}
            capacity={view.capacity}
            basis={view.basis}
            label={`${host} memory`}
        />
    );
}

function RunningBlock({ row }: { row: MachineRow }) {
    const { node, engines } = row;
    const recent = node.recent ?? [];
    const measured = measuredView(node);
    const estimated = estimatedView(node, engines);
    return (
        <Block title="Running">
            <MemoryGauge view={measured} host={node.host} />
            {(measured === null || (estimated?.segments.length ?? 0) > 0) && (
                <MemoryGauge view={estimated} host={node.host} />
            )}
            {engines.length === 0 && node.jobs.length === 0 ? (
                <Muted>
                    {node.online ? "Idle: no engine and no job." : "Nothing while offline."}
                </Muted>
            ) : (
                <ul className="flex flex-col divide-y">
                    {engines.map((engine) => (
                        <EngineItem key={engine.id} engine={engine} />
                    ))}
                    {node.jobs.map((job) => (
                        <li
                            key={job.id}
                            className="flex flex-wrap items-baseline justify-between gap-x-3 py-2"
                        >
                            <span>
                                <StatusText
                                    tone="info"
                                    active
                                    progress={job.progress > 0 ? percentOf(job.progress) : null}
                                >
                                    {kindNoun(job.kind)}
                                </StatusText>{" "}
                                <Link href={jobLink(job)} className={LINK}>
                                    {jobSubject(job)}
                                </Link>
                            </span>
                            <span className="text-sm text-muted-foreground tabular-nums">
                                {[
                                    `${Math.round(job.progress * 100)}%`,
                                    job.memory_bytes ? `${bytes(job.memory_bytes)} planned` : null,
                                ]
                                    .filter(Boolean)
                                    .join(" · ")}
                            </span>
                        </li>
                    ))}
                </ul>
            )}
            <h4 className="text-sm text-muted-foreground">Recent jobs</h4>
            {recent.length === 0 ? (
                <Muted>No finished job on this machine yet.</Muted>
            ) : (
                <ul className="flex flex-col gap-1">
                    {recent.map((job) => {
                        const outcome = OUTCOMES[job.outcome] ?? OUTCOMES.cancelled;
                        return (
                            <li
                                key={`${job.id}-${job.finished_at}`}
                                className="flex flex-wrap items-baseline justify-between gap-x-3"
                            >
                                <span className="min-w-0">
                                    <StatusText tone={outcome.tone}>{outcome.label}</StatusText>{" "}
                                    <Link href={jobHref(job)} className={LINK}>
                                        {`${kindNoun(job.kind)} ${jobSubject(job)}`}
                                    </Link>
                                </span>
                                <When
                                    value={job.finished_at}
                                    className="text-sm text-muted-foreground"
                                />
                            </li>
                        );
                    })}
                </ul>
            )}
        </Block>
    );
}

function VersionsBlock({ node, main }: { node: NodeInfo; main: Record<string, string> }) {
    const isMain = node.roles.includes("main");
    const versions = node.versions ?? {};
    const drift = new Set(versionDrift(node, main).map((line) => line.split(" ")[0]));
    const names = [...new Set([...Object.keys(versions), ...(isMain ? [] : Object.keys(main))])];
    if (names.length === 0) {
        return (
            <Block title="Versions">
                <Muted>This machine has not reported its versions.</Muted>
            </Block>
        );
    }
    return (
        <Block title="Versions">
            <div className="rounded-md border">
                <Table>
                    <TableHeader>
                        <TableRow className="hover:bg-transparent">
                            <TableHead>Library</TableHead>
                            <TableHead>This machine</TableHead>
                            {!isMain && <TableHead>Main</TableHead>}
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {names.map((name) => (
                            <TableRow
                                key={name}
                                className={
                                    drift.has(name)
                                        ? "bg-warning-soft hover:bg-warning-soft"
                                        : undefined
                                }
                            >
                                <TableCell>{name}</TableCell>
                                <TableCell className="font-mono">
                                    {drift.has(name) ? (
                                        <StatusText tone="warning">{versions[name]}</StatusText>
                                    ) : (
                                        (versions[name] ?? "–")
                                    )}
                                </TableCell>
                                {!isMain && (
                                    <TableCell className="font-mono text-muted-foreground">
                                        {main[name] ?? "–"}
                                    </TableCell>
                                )}
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </div>
        </Block>
    );
}

function ConnectionBlock({ row }: { row: MachineRow }) {
    const { node, pool, engines } = row;
    const isMain = node.roles.includes("main");
    const heartbeat = isMain
        ? "This is the main process"
        : node.seen_at
          ? `${relativeTime(node.seen_at)} · ${exactTime(node.seen_at)}`
          : "Never";
    return (
        <Block title="Connection">
            <Facts
                items={[
                    [
                        "Host",
                        <span key="host" className="font-mono">
                            {node.host}
                        </span>,
                    ],
                    ...engines.map((engine): [string, ReactNode] => [
                        `${engineLabel(engine.engine)} address`,
                        <span key={engine.id} className="font-mono">
                            {engine.url}
                        </span>,
                    ]),
                    ["Pool", <PoolLink key="pool" name={pool.name} />],
                    ["Last heartbeat", heartbeat],
                ]}
            />
        </Block>
    );
}

const TONES: Record<Problem["severity"], Tone> = {
    critical: "destructive",
    warning: "warning",
    info: "info",
};

function DiskFix({ problem, node }: { problem: Problem; node: NodeInfo }) {
    if (node.roles.includes("main")) {
        return (
            <span>
                {"See what takes the space and remove what you no longer need: "}
                <Link href="/infrastructure/storage" className={LINK}>
                    Storage
                </Link>
            </span>
        );
    }
    const disk = (node.disks ?? []).find((item) => problem.id.endsWith(`:${item.path}`));
    return (
        <span>
            {disk?.minibrain_bytes
                ? `Free up space on ${node.host}: minibrain keeps ${bytes(disk.minibrain_bytes)} in ${disk.path}.`
                : `Free up space on ${node.host}.`}
        </span>
    );
}

function Fix({ problem, row }: { problem: Problem; row: MachineRow }) {
    if (problem.kind === "machine_offline") {
        return <RestartFix node={row.node} pool={row.pool.name} />;
    }
    if (problem.kind === "version_mismatch") {
        return (
            <>
                <span>{`Install the versions main runs on ${row.node.host}, then restart it.`}</span>
                <RestartFix node={row.node} pool={row.pool.name} />
            </>
        );
    }
    if (problem.kind === "disk_low") {
        return <DiskFix problem={problem} node={row.node} />;
    }
    return (
        <span>
            {"Check the model's deployment and its weights: "}
            <Link href={problem.href} className={LINK}>
                Open the model
            </Link>
        </span>
    );
}

function ProblemsBlock({ row, problems }: { row: MachineRow; problems: Problem[] }) {
    if (problems.length === 0) {
        return null;
    }
    return (
        <section aria-label="Problems" className="flex flex-col gap-3 rounded-md border p-3">
            {problems.map((problem) => (
                <StatusText
                    key={problem.id}
                    tone={TONES[problem.severity]}
                    className="whitespace-normal"
                >
                    {problem.text}
                </StatusText>
            ))}
            <Collapsible>
                <CollapsibleTrigger>How to fix</CollapsibleTrigger>
                <CollapsibleContent className="flex flex-col gap-3 pt-3">
                    {problems.map((problem) => (
                        <div
                            key={problem.id}
                            className="flex min-w-0 flex-col items-start gap-1.5 text-sm text-muted-foreground"
                        >
                            <Fix problem={problem} row={row} />
                        </div>
                    ))}
                </CollapsibleContent>
            </Collapsible>
        </section>
    );
}

export function MachineSummary({ row }: { row: MachineRow }) {
    return (
        <>
            <MachineState row={row} />
            <span>{`· ${row.node.roles.join(", ")} · ${hardwareText(row.node)}`}</span>
        </>
    );
}

export function MachineBlocks({
    row,
    main,
    info,
    problems,
    after,
}: {
    row: MachineRow;
    main: Record<string, string>;
    info: InfrastructureInfo | undefined;
    problems: Problem[];
    after?: ReactNode;
}) {
    return (
        <>
            <ProblemsBlock row={row} problems={problems} />
            <HardwareBlock row={row} info={info} />
            {after}
            <RunningBlock row={row} />
            <Block title="Live">
                <LiveMetrics row={row} />
            </Block>
            <VersionsBlock node={row.node} main={main} />
            <ConnectionBlock row={row} />
            <Block title="Actions">
                <MachineActions row={row} />
            </Block>
        </>
    );
}

export function MachineSheet({
    row,
    main,
    info,
    problems,
    onClose,
}: {
    row: MachineRow | null;
    main: Record<string, string>;
    info: InfrastructureInfo | undefined;
    problems: Problem[];
    onClose: () => void;
}) {
    const popup = useRef<HTMLDivElement>(null);
    return (
        <Sheet open={row !== null} onOpenChange={(open) => !open && onClose()}>
            <SheetContent
                ref={popup}
                initialFocus={popup}
                className="flex flex-col gap-5 overflow-y-auto sm:max-w-xl"
            >
                {row && (
                    <>
                        <SheetHeader>
                            <SheetTitle className="font-mono">{row.node.host}</SheetTitle>
                            <SheetDescription className="flex flex-wrap items-baseline gap-x-2">
                                <MachineSummary row={row} />
                            </SheetDescription>
                        </SheetHeader>
                        <MachineBlocks row={row} main={main} info={info} problems={problems} />
                    </>
                )}
            </SheetContent>
        </Sheet>
    );
}
