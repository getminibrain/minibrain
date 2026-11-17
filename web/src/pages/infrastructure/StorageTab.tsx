import { IconCylinder, IconServer, IconStack2 } from "@tabler/icons-react";
import type { ColumnDef } from "@tanstack/react-table";
import { DataGrid } from "obp-ui";
import type { ReactNode } from "react";
import { CopyButton } from "~/components/CopyButton";
import { MiddleTruncate } from "~/components/MiddleTruncate";
import { PoolLink } from "~/components/PoolLink";
import { PanelSection, PanelSections } from "~/components/Section";
import { type GaugeKind, type GaugeSegment, UsageGauge } from "~/components/UsageGauge";
import { StatusText } from "~/components/models/StatusText";
import { bytes, relativeTime } from "~/lib/time";
import { FreeUpSection } from "./FreeUpSection";
import { UsageSection } from "./UsageSection";
import {
    type InfrastructureInfo,
    MachineName,
    type NodeInfo,
    type PoolInfo,
    type StoreInfo,
} from "./parts";

const CATEGORY_KIND: Record<string, GaugeKind> = {
    Database: "database",
    "Model files": "weights",
    "Dataset versions": "datasets",
    "Uploads, adapters and results": "uploads",
};

const STORE_KIND: Record<StoreInfo["kind"], string> = {
    sqlite: "SQLite file",
    postgres: "Postgres",
    folder: "Folder",
    s3: "S3 bucket",
};

type Disk = { key: string; free: number; total: number; stores: StoreInfo[] };

function disksOf(stores: StoreInfo[]): Disk[] {
    const found = new Map<string, Disk>();
    for (const store of stores) {
        if (store.free_bytes === null || store.free_bytes === undefined || !store.total_bytes) {
            continue;
        }
        const key = store.disk ?? `${store.total_bytes}`;
        const disk = found.get(key) ?? {
            key,
            free: store.free_bytes,
            total: store.total_bytes,
            stores: [],
        };
        disk.stores.push(store);
        found.set(key, disk);
    }
    return [...found.values()];
}

function shareSegments(disk: Disk): GaugeSegment[] {
    return disk.stores.map((store) => ({
        key: store.name,
        kind: CATEGORY_KIND[store.name] ?? "other",
        label: store.name,
        legend: store.name,
        bytes: store.used_bytes ?? 0,
    }));
}

function diskSegments(free: number, total: number, ours: number): GaugeSegment[] {
    return [
        { key: "minibrain", kind: "minibrain", label: "minibrain", bytes: ours },
        {
            key: "other",
            kind: "other",
            label: "Other files on the disk",
            bytes: Math.max(0, total - free - ours),
        },
    ];
}

function commonFolder(paths: string[]): string {
    const split = paths.map((path) => path.split("/"));
    const shared: string[] = [];
    for (let index = 0; index < (split[0]?.length ?? 0); index += 1) {
        const part = split[0][index];
        if (split.some((parts) => parts[index] !== part)) {
            break;
        }
        shared.push(part);
    }
    return shared.join("/") || "/";
}

const LOW_FREE_SHARE = 0.1;
const LOW_FREE_BYTES = 10 * 1024 ** 3;

function lowSpace(free: number, total: number): boolean {
    return total > 0 && (free < LOW_FREE_BYTES || free / total < LOW_FREE_SHARE);
}

type DiskView = {
    mount: string;
    where: string;
    free: number;
    total: number;
    ours: number;
    share: GaugeSegment[];
    heading?: ReactNode;
    footer?: ReactNode;
};

function DiskCard({ view }: { view: DiskView }) {
    const { mount, where, free, total, ours, share } = view;
    const low = lowSpace(free, total);
    const left = `${bytes(free)} free of ${bytes(total)}`;
    return (
        <div className="flex min-w-0 flex-col gap-3 px-4 py-3">
            <div className="flex min-w-0 flex-col gap-0.5">
                {view.heading}
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                    <span className="min-w-0 truncate font-mono font-medium">{mount}</span>
                    <span className="text-sm tabular-nums">
                        {low ? (
                            <StatusText tone="warning">{left}</StatusText>
                        ) : (
                            <span className="text-muted-foreground">{left}</span>
                        )}
                    </span>
                </div>
                <MiddleTruncate text={where} className="text-sm text-muted-foreground" />
            </div>
            <UsageGauge
                segments={diskSegments(free, total, ours)}
                capacity={total}
                low={low}
                label={`Disk use of ${mount}`}
            />
            {share.length > 1 && ours > 0 && (
                <div className="flex flex-col gap-1.5">
                    <p className="text-sm text-muted-foreground tabular-nums">
                        {`minibrain's share · ${bytes(ours)}`}
                    </p>
                    <UsageGauge
                        segments={share}
                        capacity={ours}
                        free={false}
                        label={`minibrain's share of ${mount}`}
                    />
                </div>
            )}
            {view.footer}
        </div>
    );
}

function mainDiskView(disk: Disk): DiskView {
    const share = shareSegments(disk);
    const where = commonFolder(disk.stores.map((store) => store.location));
    return {
        mount: disk.stores[0]?.mount ?? where,
        where,
        free: disk.free,
        total: disk.total,
        ours: share.reduce((sum, segment) => sum + segment.bytes, 0),
        share,
    };
}

type MachineDisk = { key: string; node: NodeInfo; pool: string; view: DiskView };

function machineDisks(pools: PoolInfo[]): MachineDisk[] {
    return pools.flatMap((pool) =>
        pool.nodes
            .filter((node) => !node.roles.includes("main"))
            .flatMap((node) =>
                (node.disks ?? []).flatMap((disk) =>
                    disk.total_bytes && disk.free_bytes !== null && disk.free_bytes !== undefined
                        ? [
                              {
                                  key: `${node.id}-${disk.path}`,
                                  node,
                                  pool: pool.name,
                                  view: {
                                      mount: disk.mount ?? disk.path,
                                      where: disk.path,
                                      free: disk.free_bytes,
                                      total: disk.total_bytes,
                                      ours: disk.minibrain_bytes ?? 0,
                                      share: [],
                                      footer: <CacheLine cache={disk.cache_bytes} />,
                                  },
                              },
                          ]
                        : [],
                ),
            ),
    );
}

function CacheLine({ cache }: { cache: number | null | undefined }) {
    return (
        <p className="text-sm text-muted-foreground tabular-nums">
            {cache === null || cache === undefined
                ? "Cache not reported; this machine runs an older minibrain."
                : `Cache · ${bytes(cache)} of model copies and downloads it can fetch again`}
        </p>
    );
}

function MachineDisksSection({ pools }: { pools: PoolInfo[] }) {
    const disks = machineDisks(pools);
    return (
        <PanelSection
            flush
            icon={IconServer}
            title="Disks on other machines"
            description="The disk each worker and engine keeps model copies, downloads and job files on, as each last reported."
        >
            {disks.length === 0 ? (
                <p className="px-4 py-3 text-muted-foreground">
                    No other machine has reported its disk.
                </p>
            ) : (
                <div className="flex flex-col divide-y">
                    {disks.map((disk) => (
                        <DiskCard
                            key={disk.key}
                            view={{
                                ...disk.view,
                                heading: (
                                    <span className="flex flex-wrap items-baseline gap-x-2 text-sm text-muted-foreground">
                                        <MachineName node={disk.node} />
                                        <PoolLink name={disk.pool} />
                                        {!disk.node.online && disk.node.disks?.[0]?.reported_at && (
                                            <span>{`reported ${relativeTime(disk.node.disks[0].reported_at)}`}</span>
                                        )}
                                    </span>
                                ),
                            }}
                        />
                    ))}
                </div>
            )}
        </PanelSection>
    );
}

function inHome(location: string, home: string): string {
    if (!home || !location.startsWith(`${home}/`)) {
        return location;
    }
    const name = home.split("/").filter(Boolean).pop() ?? home;
    return `${name}${location.slice(home.length)}`;
}

function storeColumns(home: string): ColumnDef<StoreInfo, unknown>[] {
    return [
        { header: "Holds", accessorKey: "name" },
        { header: "Kind", id: "kind", cell: ({ row }) => STORE_KIND[row.original.kind] },
        {
            header: "Where",
            id: "location",
            cell: ({ row }) => (
                <span className="flex min-w-0 items-center gap-1">
                    <MiddleTruncate
                        text={inHome(row.original.location, home)}
                        className="max-w-72"
                    />
                    <CopyButton
                        value={row.original.location}
                        label={`Copy the full path of ${row.original.name}`}
                    />
                </span>
            ),
        },
        {
            header: "Used",
            id: "used",
            cell: ({ row }) => (
                <span className="tabular-nums">{bytes(row.original.used_bytes)}</span>
            ),
        },
    ];
}

function StorageSection({ info }: { info: InfrastructureInfo | undefined }) {
    const stores = info?.stores ?? [];
    const disks = disksOf(stores);
    return (
        <PanelSection
            flush
            icon={IconCylinder}
            title="Disks on main"
            description="What minibrain keeps on each disk, and what is left."
        >
            {disks.length === 0 ? (
                <p className="px-4 py-3 text-muted-foreground">No store is on a local disk.</p>
            ) : (
                <div className="flex flex-col divide-y">
                    {disks.map((disk) => (
                        <DiskCard key={disk.key} view={mainDiskView(disk)} />
                    ))}
                </div>
            )}
        </PanelSection>
    );
}

function StoresSection({ info }: { info: InfrastructureInfo | undefined }) {
    const home = info?.home ?? "";
    return (
        <PanelSection bare icon={IconStack2} title="Stores">
            <div className="flex flex-col gap-3">
                <DataGrid columns={storeColumns(home)} rows={info?.stores ?? []} />
                <p className="flex min-w-0 items-baseline gap-1 text-sm text-muted-foreground">
                    <span className="shrink-0">Everything lives under</span>
                    <MiddleTruncate text={home || "…"} className="text-foreground" />
                    <span className="shrink-0">
                        {"· set "}
                        <span className="font-mono text-foreground">MINIBRAIN_HOME</span>
                        {" to move it"}
                    </span>
                </p>
            </div>
        </PanelSection>
    );
}

export function StorageTab({
    info,
    pools,
}: {
    info: InfrastructureInfo | undefined;
    pools: PoolInfo[];
}) {
    return (
        <PanelSections>
            <StorageSection info={info} />
            <UsageSection info={info} />
            <FreeUpSection info={info} />
            <MachineDisksSection pools={pools} />
            <StoresSection info={info} />
        </PanelSections>
    );
}
