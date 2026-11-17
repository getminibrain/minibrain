import { IconSitemap } from "@tabler/icons-react";
import { cn } from "obp-ui";
import type { ReactNode } from "react";
import { PanelSection } from "~/components/Section";
import { type InfrastructureInfo, OnlineCount, type PoolInfo, fleetAnchor, plural } from "./parts";

const SETUPS: Record<InfrastructureInfo["setup"], { title: string; body: string }> = {
    one_machine: {
        title: "One machine",
        body: "main, the gateway, the worker and engines all run here, with SQLite and local folders.",
    },
    remote_gpus: {
        title: "Local main, remote GPUs",
        body: "main and its gateway run here; workers and engines on other machines join pools and pull work from main.",
    },
    distributed: {
        title: "Distributed",
        body: "Separate services: mains share a Postgres database, and gateways and GPU pools scale on their own.",
    },
};

const LOOPS: Record<string, string> = {
    single: "Runs background loops",
    leader: "Runs background loops (leader)",
    standby: "Standby",
};

function Node({
    title,
    children,
    className,
}: {
    title: ReactNode;
    children?: ReactNode;
    className?: string;
}) {
    return (
        <div
            className={cn(
                "flex min-w-0 flex-col gap-0.5 rounded-lg border bg-card px-3 py-2",
                className,
            )}
        >
            <span className="truncate font-medium">{title}</span>
            {children}
        </div>
    );
}

function Connector({ label }: { label: string }) {
    return (
        <div className="flex min-w-fit flex-1 flex-col items-center justify-center gap-0.5 self-center">
            <span className="px-2 text-sm whitespace-nowrap text-muted-foreground">{label}</span>
            <span aria-hidden className="flex w-full items-center">
                <span className="h-px flex-1 bg-border" />
                <span className="size-0 border-y-4 border-l-6 border-y-transparent border-l-border" />
            </span>
        </div>
    );
}

function PoolBox({ pool }: { pool: PoolInfo }) {
    return (
        <li className="relative py-1 pl-6 before:absolute before:top-1/2 before:left-0 before:h-px before:w-6 before:bg-border after:absolute after:top-0 after:bottom-0 after:left-0 after:w-px after:bg-border first:after:top-1/2 last:after:bottom-1/2 only:after:hidden">
            <a
                href={`#${fleetAnchor(pool.name)}`}
                className="flex min-w-0 flex-col gap-0.5 rounded-lg border bg-card px-3 py-2 hover:bg-accent"
            >
                <span className="truncate font-medium">{pool.name}</span>
                <span className="flex items-baseline gap-3 text-sm text-muted-foreground tabular-nums">
                    <OnlineCount nodes={pool.nodes} />
                    <span>{plural(pool.engines.length, "engine")}</span>
                </span>
            </a>
        </li>
    );
}

export function SetupDiagram({
    info,
    pools,
    loops,
}: {
    info: InfrastructureInfo | undefined;
    pools: PoolInfo[];
    loops: string | undefined;
}) {
    const setup = info ? SETUPS[info.setup] : null;
    const separate = info?.setup === "distributed";
    return (
        <PanelSection
            icon={IconSitemap}
            title="Setup"
            description={setup ? `${setup.title}. ${setup.body}` : undefined}
        >
            <div className="overflow-x-auto">
                <div className="flex min-w-[38rem] items-center">
                    <Node title="main" className="w-44 shrink-0">
                        <span className="truncate font-mono text-sm text-muted-foreground">
                            {info?.host ?? "…"}
                        </span>
                        <span className="text-sm text-muted-foreground">
                            {LOOPS[loops ?? "single"]}
                        </span>
                    </Node>
                    <Connector label={separate ? "config" : "hosts"} />
                    <Node title="gateway" className="w-32 shrink-0">
                        <span className="text-sm text-muted-foreground">
                            {separate ? "Runs on its own" : "Inside main"}
                        </span>
                    </Node>
                    <Connector label="/v1 traffic" />
                    <ul className="flex max-w-80 min-w-56 flex-1 flex-col">
                        {pools.map((pool) => (
                            <PoolBox key={pool.name} pool={pool} />
                        ))}
                    </ul>
                </div>
            </div>
        </PanelSection>
    );
}
