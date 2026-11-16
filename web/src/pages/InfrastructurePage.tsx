import { useRouterState } from "@tanstack/react-router";
import type { ColumnDef } from "@tanstack/react-table";
import { Cpu, MemoryStick } from "lucide-react";
import { DataGrid, TabNav, type TabNavItem } from "obp-ui";
import { useInfrastructure, usePools, useSystem } from "~/api/queries";
import type { components } from "~/api/schema";
import { PageHeader } from "~/components/PageHeader";
import { ErrorLine, Page, PanelSection, PanelSections, Stat } from "~/components/Section";
import { useCan } from "~/lib/access";
import { count } from "~/lib/format";
import { AddMachine } from "./infrastructure/AddMachine";
import { FleetBoard } from "./infrastructure/FleetBoard";
import { JoinRequests } from "./infrastructure/JoinRequests";
import { MachinesTab } from "./infrastructure/MachinesTab";
import { NeedsALook } from "./infrastructure/NeedsALook";
import { SetupDiagram } from "./infrastructure/SetupDiagram";
import { StorageTab } from "./infrastructure/StorageTab";
import type { InfrastructureInfo, PoolInfo } from "./infrastructure/parts";

type LoadedModel = components["schemas"]["LoadedModel"];

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
    const can = useCan();
    const adds = can.admin && active !== "/infrastructure/storage";
    return (
        <Page wide>
            <PageHeader
                title="Infrastructure"
                caption="Where minibrain runs and where it keeps its data."
                actions={adds ? <AddMachine pools={pools.data ?? []} /> : undefined}
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
                    {can.admin && <JoinRequests pools={pools.data ?? []} />}
                    <MachinesTab
                        pools={pools.data ?? []}
                        main={main}
                        info={infrastructure.data}
                        loading={pools.isLoading}
                    />
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
            {active === "/infrastructure/storage" && (
                <StorageTab info={infrastructure.data} pools={pools.data ?? []} />
            )}
        </Page>
    );
}
