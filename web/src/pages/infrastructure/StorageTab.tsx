import {
    IconArchive,
    IconDeviceSdCard,
    IconEraser,
    IconFiles,
    IconServer,
    IconStack2,
} from "@tabler/icons-react";
import type { ColumnDef } from "@tanstack/react-table";
import { DataGrid, Link } from "obp-ui";
import type { ReactNode } from "react";
import { CopyButton } from "~/components/CopyButton";
import { MiddleTruncate } from "~/components/MiddleTruncate";
import { PoolLink } from "~/components/PoolLink";
import { PanelSection, PanelSections, Stat } from "~/components/Section";
import { type GaugeKind, type GaugeSegment, UsageGauge } from "~/components/UsageGauge";
import { StatusText } from "~/components/models/StatusText";
import { count } from "~/lib/format";
import { JOBS_PATH, modelPageHref, modelVersionHref } from "~/lib/modelLinks";
import { bytes, relativeTime } from "~/lib/time";
import { datasetHref } from "~/pages/models/list/cells";
import { lowSpace } from "./NeedsALook";
import {
    type InfrastructureInfo,
    MachineName,
    type NodeInfo,
    type PoolInfo,
    type StoreInfo,
    plural,
} from "./parts";

type StoredItem = InfrastructureInfo["largest"][number];
type Reclaimable = NonNullable<InfrastructureInfo["reclaimable"]>;

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

const ITEM_KIND: Record<StoredItem["kind"], string> = {
    model: "Model files",
    dataset: "Dataset versions",
    adapter: "Adapter",
    upload: "Upload",
    log: "Job log",
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

type DiskView = {
    mount: string;
    where: string;
    free: number;
    total: number;
    ours: number;
    share: GaugeSegment[];
    heading?: ReactNode;
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
                                  },
                              },
                          ]
                        : [],
                ),
            ),
    );
}

function MachineDisksSection({ pools }: { pools: PoolInfo[] }) {
    const disks = machineDisks(pools);
    return (
        <PanelSection
            flush
            icon={IconServer}
            title="Disks on other machines"
            description="The disk each worker and engine keeps model copies and job files on, as each last reported."
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

function itemHref(item: StoredItem): string {
    if (item.kind === "model") {
        return modelPageHref(item.key);
    }
    if (item.kind === "adapter" && item.version !== null && item.version !== undefined) {
        return modelVersionHref(item.key, item.version);
    }
    if (item.kind === "upload") {
        return `/data?item=source:${encodeURIComponent(item.key)}`;
    }
    if (item.kind === "log") {
        return `${JOBS_PATH}/${item.key}`;
    }
    return datasetHref(item.key);
}

const ITEM_COLUMNS: ColumnDef<StoredItem, unknown>[] = [
    {
        header: "Item",
        id: "name",
        cell: ({ row }) => (
            <Link href={itemHref(row.original)} className="text-primary hover:underline">
                {row.original.name}
            </Link>
        ),
    },
    { header: "Kind", id: "kind", cell: ({ row }) => ITEM_KIND[row.original.kind] },
    {
        header: "Size",
        id: "size",
        cell: ({ row }) => <span className="tabular-nums">{bytes(row.original.size_bytes)}</span>,
    },
];

function StorageSection({ info }: { info: InfrastructureInfo | undefined }) {
    const stores = info?.stores ?? [];
    const disks = disksOf(stores);
    return (
        <PanelSection
            flush
            icon={IconDeviceSdCard}
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

type FreeRow = { key: string; what: ReactNode; detail: string; size: number; where: ReactNode };

const FREE_COLUMNS: ColumnDef<FreeRow, unknown>[] = [
    { header: "What", id: "what", cell: ({ row }) => row.original.what },
    {
        header: "Why it is safe",
        id: "detail",
        cell: ({ row }) => <span className="text-muted-foreground">{row.original.detail}</span>,
    },
    {
        header: "Size",
        id: "size",
        cell: ({ row }) => <span className="tabular-nums">{bytes(row.original.size)}</span>,
    },
    { header: "Managed in", id: "where", cell: ({ row }) => row.original.where },
];

function TextLink({ href, children }: { href: string; children: ReactNode }) {
    return (
        <Link href={href} className="text-primary hover:underline">
            {children}
        </Link>
    );
}

function freeRows(found: Reclaimable): FreeRow[] {
    const rows: FreeRow[] = [];
    if (found.dataset_versions > 0) {
        rows.push({
            key: "dataset-versions",
            what: plural(found.dataset_versions, "dataset version"),
            detail: "Past retention; the next cleanup removes them.",
            size: found.dataset_versions_bytes,
            where: <TextLink href="/settings/data">Retention</TextLink>,
        });
    }
    for (const model of found.unused_models) {
        rows.push({
            key: `model-${model.key}`,
            what: `${model.name} files`,
            detail: "No model is built on it and it is not deployed.",
            size: model.size_bytes,
            where: <TextLink href={modelPageHref(model.key)}>Model page</TextLink>,
        });
    }
    if (found.orphan_uploads > 0) {
        rows.push({
            key: "uploads",
            what: plural(found.orphan_uploads, "uploaded file"),
            detail: "No source refers to them.",
            size: found.orphan_uploads_bytes,
            where: <TextLink href="/data">Data</TextLink>,
        });
    }
    return rows;
}

function FreeUpSection({ info }: { info: InfrastructureInfo | undefined }) {
    const rows = info?.reclaimable ? freeRows(info.reclaimable) : [];
    const total = rows.reduce((sum, row) => sum + row.size, 0);
    return (
        <PanelSection
            bare
            icon={IconEraser}
            title="Free up space"
            description={
                rows.length > 0
                    ? `${bytes(total)} could be removed without breaking any model, dataset or source.`
                    : "What could be removed without breaking any model, dataset or source."
            }
        >
            <DataGrid columns={FREE_COLUMNS} rows={rows} empty="Nothing to free up." />
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

function LargestSection({ info }: { info: InfrastructureInfo | undefined }) {
    const items = info?.largest ?? [];
    return (
        <PanelSection
            bare
            icon={IconFiles}
            title="Largest items"
            description="Base model files on main, dataset versions, adapters, uploads and job logs, biggest first."
        >
            <DataGrid columns={ITEM_COLUMNS} rows={items} empty="Nothing stored yet." />
        </PanelSection>
    );
}

function VersionUsageSection({ info }: { info: InfrastructureInfo | undefined }) {
    const usage = info?.dataset_versions;
    return (
        <PanelSection
            icon={IconArchive}
            title="Dataset versions"
            description="Saved copies of dataset rows that models train and score on, and the copies that add accepted feedback. Identical rows are stored once."
        >
            <div className="flex flex-col gap-3">
                <div className="flex flex-wrap gap-x-8 gap-y-4">
                    <Stat label="Copies" value={count(usage?.count)} />
                    <Stat label="Stored" value={bytes(usage?.size)} />
                    <Stat label="Used by models" value={count(usage?.for_versions)} />
                    <Stat label="Unused, kept" value={count(usage?.saved)} />
                </div>
                <p className="text-sm text-muted-foreground">
                    {`Versions a model uses are kept, and so is each dataset's latest; of the rest, the last ${count(usage?.keep)} per dataset stay. `}
                    <Link href="/settings/data" className="text-primary hover:underline">
                        Change retention
                    </Link>
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
            <MachineDisksSection pools={pools} />
            <FreeUpSection info={info} />
            <LargestSection info={info} />
            <StoresSection info={info} />
            <VersionUsageSection info={info} />
        </PanelSections>
    );
}
