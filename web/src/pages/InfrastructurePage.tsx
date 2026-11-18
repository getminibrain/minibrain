import { IconCpu, IconMemory } from "@tabler/icons-react";
import { useRouterState } from "@tanstack/react-router";
import type { ColumnDef } from "@tanstack/react-table";
import { DataGrid, TabNav, type TabNavItem } from "obp-ui";
import { useInfrastructure, usePools, useSystem } from "~/api/queries";
import type { components } from "~/api/schema";
import { PageHeader } from "~/components/PageHeader";
import {
    ErrorLine,
    FLUSH_GRID,
    Page,
    PanelColumns,
    PanelSection,
    PanelSections,
    Stat,
} from "~/components/Section";
import { useCan } from "~/lib/access";
import { count } from "~/lib/format";
import { AddMachine } from "./infrastructure/AddMachine";
import { JoinRequests } from "./infrastructure/JoinRequests";
import { MachinesTab } from "./infrastructure/MachinesTab";
import { SetupDiagram } from "./infrastructure/SetupDiagram";
import { StorageTab } from "./infrastructure/StorageTab";
import { StoresSection } from "./infrastructure/StoresSection";
import { LayoutSwitch } from "./infrastructure/layouts/switcher";
import type { InfrastructureInfo, PoolInfo } from "./infrastructure/parts";

type LoadedModel = components["schemas"]["LoadedModel"];
type SystemInfo = components["schemas"]["SystemInfo"];

const LOOPS: Record<string, string> = {
    single: "Runs here",
    leader: "Runs here (leader)",
    standby: "Standby",
};

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
        accessorFn: (model) => model.adapters.length,
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

const MACHINES = "/infrastructure";
const STORAGE = "/infrastructure/storage";
const SETUP = "/infrastructure/setup";

const SECTIONS: TabNavItem[] = [
    { label: "Machines", href: MACHINES },
    { label: "Storage", href: STORAGE },
    { label: "Setup", href: SETUP },
];

function sectionOf(pathname: string): string {
    return (
        SECTIONS.find((item) => item.href !== MACHINES && item.href === pathname)?.href ?? MACHINES
    );
}

function SetupTab({
    info,
    pools,
    system,
}: {
    info: InfrastructureInfo | undefined;
    pools: PoolInfo[];
    system: SystemInfo | undefined;
}) {
    const device = system?.device;
    return (
        <PanelSections>
            <SetupDiagram info={info} pools={pools} loops={system?.loops} />
            <PanelColumns stretch>
                <PanelSection
                    icon={IconCpu}
                    title="This main process"
                    description="The devices this process uses for inference and training."
                >
                    <div className="grid grid-cols-3 gap-x-8 gap-y-4">
                        <Stat
                            label="Inference"
                            value={<span className="font-mono">{device?.inference ?? "–"}</span>}
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
                        <Stat label="Background loops" value={LOOPS[system?.loops ?? "single"]} />
                    </div>
                </PanelSection>
                <PanelSection
                    flush
                    icon={IconMemory}
                    title="Loaded in memory"
                    description="Base models and adapters the serving process holds right now."
                >
                    <div className={FLUSH_GRID}>
                        <DataGrid
                            columns={LOADED_COLUMNS}
                            rows={system?.loaded ?? []}
                            empty="Nothing loaded yet; the first request loads the base model."
                        />
                    </div>
                </PanelSection>
            </PanelColumns>
            <StoresSection info={info} />
        </PanelSections>
    );
}

export function InfrastructurePage() {
    const pathname = useRouterState({ select: (state) => state.location.pathname });
    const system = useSystem();
    const { data, error } = system;
    const pools = usePools();
    const infrastructure = useInfrastructure();
    const main =
        (pools.data ?? []).flatMap((pool) => pool.nodes).find((node) => node.roles.includes("main"))
            ?.versions ?? {};
    const active = sectionOf(pathname);
    const can = useCan();
    const adds = can.admin && active === MACHINES;
    return (
        <Page wide>
            <PageHeader
                title="Infrastructure"
                caption="Where minibrain runs and where it keeps its data."
                actions={
                    active === MACHINES ? (
                        <>
                            <LayoutSwitch />
                            {adds && <AddMachine pools={pools.data ?? []} />}
                        </>
                    ) : undefined
                }
            />
            <TabNav label="Infrastructure pages" tabs={SECTIONS} />
            <ErrorLine
                error={error ?? pools.error ?? infrastructure.error}
                onRetry={() =>
                    Promise.all([system.refetch(), pools.refetch(), infrastructure.refetch()])
                }
            />
            {active === MACHINES && (
                <PanelSections>
                    {can.admin && <JoinRequests pools={pools.data ?? []} />}
                    <MachinesTab
                        pools={pools.data ?? []}
                        main={main}
                        info={infrastructure.data}
                        loading={pools.isLoading}
                    />
                </PanelSections>
            )}
            {active === STORAGE && (
                <StorageTab info={infrastructure.data} pools={pools.data ?? []} />
            )}
            {active === SETUP && (
                <SetupTab info={infrastructure.data} pools={pools.data ?? []} system={data} />
            )}
        </Page>
    );
}
