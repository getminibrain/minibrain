import { useRouterState } from "@tanstack/react-router";
import type { ColumnDef } from "@tanstack/react-table";
import { Cpu, MemoryStick, Server } from "lucide-react";
import {
    Badge,
    DataGrid,
    TabNav,
    type TabNavItem,
    Tooltip,
    TooltipContent,
    TooltipTrigger,
} from "obp-ui";
import { useInfrastructure, usePools, useSystem } from "~/api/queries";
import type { components } from "~/api/schema";
import { PageHeader } from "~/components/PageHeader";
import { ErrorLine, Page, PanelSection, PanelSections, Stat } from "~/components/Section";
import { count } from "~/lib/format";
import { bytes, relativeTime } from "~/lib/time";
import { FleetBoard } from "./infrastructure/FleetBoard";
import { NeedsALook, differences } from "./infrastructure/NeedsALook";
import { SetupDiagram } from "./infrastructure/SetupDiagram";
import { StorageTab } from "./infrastructure/StorageTab";
import {
    type InfrastructureInfo,
    MachineName,
    type NodeInfo,
    type PoolInfo,
    type ReplicaInfo,
    plural,
} from "./infrastructure/parts";

type LoadedModel = components["schemas"]["LoadedModel"];

const LOOPS: Record<string, string> = {
    single: "Runs here",
    leader: "Runs here (leader)",
    standby: "Standby",
};

const ENGINE_LABEL: Record<string, string> = {
    sglang: "SGLang",
    vllm: "vLLM",
    mlx: "MLX",
    transformers: "Transformers",
    llamacpp: "llama.cpp",
};

const ENGINE_STATES: Record<string, string> = {
    ready: "Ready",
    loading: "Loading",
    fetching: "Fetching weights",
    failed: "Failed",
};

const ENGINE_BADGES: Record<string, "success" | "destructive"> = {
    ready: "success",
    failed: "destructive",
};

function engineNames(engines: string[]): string {
    return engines.map((engine) => ENGINE_LABEL[engine] ?? engine).join(", ");
}

function VersionCell({ node }: { node: NodeInfo }) {
    const versions = node.versions ?? {};
    const listed = Object.entries(versions)
        .map(([name, value]) => `${name} ${value}`)
        .join(" · ");
    return (
        <span className="flex items-center gap-2">
            <Tooltip>
                <TooltipTrigger asChild>
                    <span className="rounded-sm font-mono">{versions.minibrain ?? "–"}</span>
                </TooltipTrigger>
                <TooltipContent>{listed || "Not reported"}</TooltipContent>
            </Tooltip>
        </span>
    );
}

function VersionWarning({ node, main }: { node: NodeInfo; main: Record<string, string> }) {
    const differs = node.roles.includes("main") ? [] : differences(node.versions ?? {}, main);
    if (differs.length === 0) {
        return null;
    }
    return (
        <Tooltip>
            <TooltipTrigger asChild>
                <button type="button" className="rounded-sm">
                    <Badge variant="warning">Version differs</Badge>
                </button>
            </TooltipTrigger>
            <TooltipContent className="max-w-sm whitespace-normal">
                {differs.join("; ")}
            </TooltipContent>
        </Tooltip>
    );
}

function nodeColumns(main: Record<string, string>): ColumnDef<NodeInfo, unknown>[] {
    return [
        {
            header: "Machine",
            id: "host",
            enableHiding: false,
            cell: ({ row }) => (
                <span className="flex min-w-0 items-center gap-2">
                    <MachineName node={row.original} />
                    <VersionWarning node={row.original} main={main} />
                </span>
            ),
        },
        ...NODE_COLUMNS,
        {
            header: "Version",
            id: "version",
            cell: ({ row }) => <VersionCell node={row.original} />,
        },
    ];
}

const NODE_COLUMNS: ColumnDef<NodeInfo, unknown>[] = [
    { header: "Role", id: "roles", cell: ({ row }) => row.original.roles.join(", ") },
    {
        header: "Accelerator",
        id: "hardware",
        cell: ({ row }) => row.original.accelerator_name || row.original.accelerator,
    },
    {
        header: "Memory for models",
        id: "usable",
        cell: ({ row }) => <span className="tabular-nums">{bytes(row.original.usable_bytes)}</span>,
    },
    {
        header: "CPU and RAM",
        id: "cpu",
        cell: ({ row }) => (
            <span className="tabular-nums">{`${row.original.cpu_count} cores · ${bytes(row.original.ram_bytes)}`}</span>
        ),
    },
    {
        header: "Engines available",
        id: "engines",
        cell: ({ row }) => engineNames(row.original.engines),
    },
    {
        header: "Seen",
        id: "seen",
        cell: ({ row }) =>
            row.original.online
                ? "Online now"
                : row.original.seen_at
                  ? relativeTime(row.original.seen_at)
                  : "Never",
    },
];

const REPLICA_COLUMNS: ColumnDef<ReplicaInfo, unknown>[] = [
    {
        header: "Model",
        accessorKey: "base_model",
        cell: (info) => <span className="font-mono">{String(info.getValue())}</span>,
    },
    { header: "Engine", id: "engine", cell: ({ row }) => engineNames([row.original.engine]) },
    {
        header: "Address",
        accessorKey: "url",
        cell: (info) => <span className="font-mono">{String(info.getValue())}</span>,
    },
    {
        header: "State",
        id: "state",
        cell: ({ row }) => (
            <Badge variant={ENGINE_BADGES[row.original.state] ?? "neutral"}>
                {ENGINE_STATES[row.original.state] ?? "Loading"}
            </Badge>
        ),
    },
    { header: "Seen", id: "seen", cell: ({ row }) => relativeTime(row.original.seen_at) },
];

function PoolSection({ pool, main }: { pool: PoolInfo; main: Record<string, string> }) {
    const online = pool.nodes.filter((node) => node.online).length;
    return (
        <PanelSection
            bare
            icon={Server}
            anchor={`pool-${pool.name}`}
            title={`Pool ${pool.name}`}
            description={[
                pool.label !== pool.name ? pool.label : null,
                `${count(online)} of ${plural(pool.nodes.length, "machine")} online`,
                `${plural(pool.engines.length, "engine")} serving`,
            ]
                .filter(Boolean)
                .join(" · ")}
        >
            <div className="flex flex-col gap-3">
                <DataGrid
                    columns={nodeColumns(main)}
                    rows={pool.nodes}
                    empty="No machines yet."
                    storageKey="minibrain.machines.columns"
                    columnPicker
                    hiddenColumns={["cpu", "engines", "version"]}
                />
                {pool.engines.length > 0 && (
                    <DataGrid columns={REPLICA_COLUMNS} rows={pool.engines} />
                )}
            </div>
        </PanelSection>
    );
}

const LOADED_COLUMNS: ColumnDef<LoadedModel, unknown>[] = [
    {
        header: "Base model",
        accessorKey: "base_model",
        cell: (info) => <span className="font-mono">{String(info.getValue())}</span>,
    },
    {
        header: "Device",
        accessorKey: "device",
        cell: (info) => <span className="font-mono">{String(info.getValue())}</span>,
    },
    {
        header: "Adapters",
        id: "adapters",
        cell: ({ row }) => (
            <span className="font-mono">
                {row.original.adapters.length ? row.original.adapters.join(", ") : "–"}
            </span>
        ),
    },
];

function gigabytes(megabytes: number | null | undefined): string {
    return megabytes === null || megabytes === undefined
        ? "–"
        : `${(megabytes / 1024).toFixed(1)} GB`;
}

const SECTIONS: TabNavItem[] = [
    { label: "Overview", href: "/infrastructure" },
    { label: "Machines", href: "/infrastructure/machines" },
    { label: "Storage", href: "/infrastructure/storage" },
];

function Overview({
    info,
    pools,
    loops,
    main,
}: {
    info: InfrastructureInfo | undefined;
    pools: PoolInfo[];
    loops: string | undefined;
    main: Record<string, string>;
}) {
    return (
        <PanelSections>
            <NeedsALook pools={pools} main={main} info={info} />
            <FleetBoard pools={pools} />
            <SetupDiagram info={info} pools={pools} loops={loops} />
        </PanelSections>
    );
}

export function InfrastructurePage() {
    const pathname = useRouterState({ select: (state) => state.location.pathname });
    const { data, error } = useSystem();
    const pools = usePools();
    const infrastructure = useInfrastructure();
    const device = data?.device;
    const main =
        (pools.data ?? []).flatMap((pool) => pool.nodes).find((node) => node.roles.includes("main"))
            ?.versions ?? {};
    const active = SECTIONS.find((item) => item.href === pathname)?.href ?? "/infrastructure";
    return (
        <Page wide>
            <PageHeader
                title="Infrastructure"
                caption="Where minibrain runs and where it keeps its data."
            />
            <TabNav label="Infrastructure pages" tabs={SECTIONS} />
            <ErrorLine error={error ?? pools.error ?? infrastructure.error} />
            {active === "/infrastructure" && (
                <Overview
                    info={infrastructure.data}
                    pools={pools.data ?? []}
                    loops={data?.loops}
                    main={main}
                />
            )}
            {active === "/infrastructure/machines" && (
                <PanelSections>
                    {(pools.data ?? []).map((pool) => (
                        <PoolSection key={pool.name} pool={pool} main={main} />
                    ))}
                    <PanelSection
                        icon={Cpu}
                        title="This main process"
                        description="Inference uses the GPU when there is one; training avoids the Apple GPU, which hangs."
                    >
                        <div className="flex flex-wrap gap-x-8 gap-y-4">
                            <Stat
                                label="Inference"
                                value={
                                    <span className="font-mono">{device?.inference ?? "–"}</span>
                                }
                            />
                            <Stat
                                label="Training"
                                value={<span className="font-mono">{device?.training ?? "–"}</span>}
                            />
                            <Stat label="Accelerator" value={device?.accelerator ?? "None"} />
                            <Stat
                                label="GPU memory used"
                                value={`${gigabytes(device?.memory_used_mb)} of ${gigabytes(device?.memory_total_mb)}`}
                            />
                            <Stat label="CPU cores" value={count(device?.cpu_count)} />
                            <Stat label="Background loops" value={LOOPS[data?.loops ?? "single"]} />
                        </div>
                    </PanelSection>
                    <PanelSection
                        bare
                        icon={MemoryStick}
                        title="Loaded in memory"
                        description="Base models and adapters the serving process holds right now."
                    >
                        <DataGrid
                            columns={LOADED_COLUMNS}
                            rows={data?.loaded ?? []}
                            empty="Nothing loaded yet; the first request loads the base model."
                        />
                    </PanelSection>
                </PanelSections>
            )}
            {active === "/infrastructure/storage" && <StorageTab info={infrastructure.data} />}
        </Page>
    );
}
