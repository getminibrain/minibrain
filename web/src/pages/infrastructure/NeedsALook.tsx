import { TriangleAlert } from "lucide-react";
import { Link } from "obp-ui";
import type { ReactNode } from "react";
import type { JoinRole } from "~/api/joinTokenQueries";
import { CopyButton } from "~/components/CopyButton";
import { PanelSection } from "~/components/Section";
import { StatusText } from "~/components/models/StatusText";
import { modelPageHref } from "~/lib/modelLinks";
import { bytes, relativeTime } from "~/lib/time";
import type { InfrastructureInfo, NodeInfo, PoolInfo, ReplicaInfo, StoreInfo } from "./parts";

const COMPARED = ["minibrain", "torch", "transformers", "peft"];
const LOW_FREE_SHARE = 0.1;
const LOW_FREE_BYTES = 10 * 1024 ** 3;

type Issue = {
    key: string;
    tone: "warning" | "destructive";
    text: string;
    fix: ReactNode;
    href: string;
};

function release(value: string): string {
    return value.split("+")[0];
}

export function differences(
    versions: Record<string, string>,
    main: Record<string, string>,
): string[] {
    return COMPARED.filter(
        (name) => versions[name] && main[name] && release(versions[name]) !== release(main[name]),
    ).map((name) => `${name} ${versions[name]} (main has ${main[name]})`);
}

export function Command({ value, label }: { value: string; label: string }) {
    return (
        <span className="flex max-w-full min-w-0 items-center gap-1 rounded-md border bg-muted pl-3">
            <code className="min-w-0 overflow-x-auto py-1 font-mono text-sm whitespace-nowrap">
                {value}
            </code>
            <CopyButton value={value} label={label} />
        </span>
    );
}

export function machineHref(node: NodeInfo): string {
    return `/infrastructure/machines?machine=${encodeURIComponent(node.id)}`;
}

export const JOIN_ENV = "MINIBRAIN_JOIN_TOKEN";

export function joinCommands(role: JoinRole, pool: string, origin: string): string[] {
    const worker = `minibrain worker --api-url ${origin} --pool ${pool}`;
    const engine = `minibrain engine --model <model> --main-url ${origin} --pool ${pool} --host 0.0.0.0`;
    if (role === "worker") {
        return [worker];
    }
    return role === "engine" ? [engine] : [worker, engine];
}

export function rejoinCommand(node: NodeInfo, pool: string, origin: string): string {
    return joinCommands(node.roles.includes("worker") ? "worker" : "engine", pool, origin)[0];
}

export function rejoinHint(node: NodeInfo): string {
    return `Run this on ${node.host}, with the pool's join token in ${JOIN_ENV}:`;
}

function offlineIssue(node: NodeInfo, pool: string, origin: string): Issue {
    const seen = node.seen_at ? relativeTime(node.seen_at) : "never";
    return {
        key: `offline-${node.id}`,
        tone: "warning",
        text: `Pool ${pool}: ${node.host} is offline (last seen ${seen})`,
        fix: (
            <>
                <span>{rejoinHint(node)}</span>
                <Command
                    value={rejoinCommand(node, pool, origin)}
                    label={`Copy the command that rejoins ${node.host}`}
                />
            </>
        ),
        href: machineHref(node),
    };
}

function driftIssue(node: NodeInfo, pool: string, main: Record<string, string>): Issue {
    return {
        key: `drift-${node.id}`,
        tone: "warning",
        text: `Pool ${pool}: ${node.host} runs different library versions from main`,
        fix: (
            <span>{`Install the versions main runs on ${node.host}, then restart it: ${differences(node.versions ?? {}, main).join("; ")}.`}</span>
        ),
        href: machineHref(node),
    };
}

function failedIssue(engine: ReplicaInfo, pool: string): Issue {
    const served = engine.serves[0];
    const href = modelPageHref(served ? served.model : engine.base_model);
    return {
        key: `failed-${engine.id}`,
        tone: "destructive",
        text: `Pool ${pool}: the engine for ${engine.base_model} on ${engine.host} failed`,
        fix: (
            <span>
                {"Check the model's deployment and its weights: "}
                <Link href={href} className="text-primary hover:underline">
                    {served ? served.name : engine.base_model}
                </Link>
            </span>
        ),
        href,
    };
}

export function lowSpace(free: number, total: number): boolean {
    return free < LOW_FREE_BYTES || free / total < LOW_FREE_SHARE;
}

export function lowDiskText(store: StoreInfo): string {
    const where = store.mount ? `Disk ${store.mount}` : store.name;
    return `${where}: only ${bytes(store.free_bytes)} free`;
}

export function lowStores(info: InfrastructureInfo | undefined): StoreInfo[] {
    const disks = new Map<string, StoreInfo>();
    for (const store of info?.stores ?? []) {
        if (
            store.free_bytes !== null &&
            store.free_bytes !== undefined &&
            store.total_bytes &&
            lowSpace(store.free_bytes, store.total_bytes)
        ) {
            const key = store.disk ?? store.name;
            disks.set(key, disks.get(key) ?? store);
        }
    }
    return [...disks.values()];
}

function lowDisk(info: InfrastructureInfo | undefined): Issue[] {
    return lowStores(info).map((store) => ({
        key: `disk-${store.name}`,
        tone: "warning",
        text: lowDiskText(store),
        fix: (
            <span>
                {"See what takes the space and remove what you no longer need: "}
                <Link href="/infrastructure/storage" className="text-primary hover:underline">
                    Storage
                </Link>
            </span>
        ),
        href: "/infrastructure/storage",
    }));
}

function issuesOf(
    pools: PoolInfo[],
    main: Record<string, string>,
    info: InfrastructureInfo | undefined,
    origin: string,
): Issue[] {
    return [
        ...pools.flatMap((pool) =>
            pool.engines
                .filter((engine) => engine.state === "failed")
                .map((engine) => failedIssue(engine, pool.name)),
        ),
        ...pools.flatMap((pool) =>
            pool.nodes
                .filter((node) => !node.online)
                .map((node) => offlineIssue(node, pool.name, origin)),
        ),
        ...pools.flatMap((pool) =>
            pool.nodes
                .filter(
                    (node) =>
                        !node.roles.includes("main") &&
                        differences(node.versions ?? {}, main).length > 0,
                )
                .map((node) => driftIssue(node, pool.name, main)),
        ),
        ...lowDisk(info),
    ];
}

export function NeedsALook({
    pools,
    main,
    info,
}: {
    pools: PoolInfo[];
    main: Record<string, string>;
    info: InfrastructureInfo | undefined;
}) {
    const issues = issuesOf(pools, main, info, window.location.origin);
    return (
        <PanelSection flush icon={TriangleAlert} title="Needs a look">
            {issues.length === 0 ? (
                <p className="px-4 py-3 text-muted-foreground">
                    Nothing: every machine is online and up to date.
                </p>
            ) : (
                <ul className="flex flex-col divide-y">
                    {issues.map((issue) => (
                        <li key={issue.key} className="flex min-w-0 flex-col gap-1.5 px-4 py-3">
                            <span className="flex flex-wrap items-baseline justify-between gap-x-3">
                                <StatusText tone={issue.tone} className="whitespace-normal">
                                    {issue.text}
                                </StatusText>
                                <Link href={issue.href} className="text-primary hover:underline">
                                    Open
                                </Link>
                            </span>
                            <span className="flex min-w-0 flex-col items-start gap-1.5 text-sm text-muted-foreground">
                                {issue.fix}
                            </span>
                        </li>
                    ))}
                </ul>
            )}
        </PanelSection>
    );
}
