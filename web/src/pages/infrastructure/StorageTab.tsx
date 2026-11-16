import type { ColumnDef } from "@tanstack/react-table";
import { Archive, FileStack, HardDrive, Layers } from "lucide-react";
import { DataGrid, Link, Tooltip, TooltipContent, TooltipTrigger } from "obp-ui";
import { PanelSection, PanelSections, Stat } from "~/components/Section";
import { type GaugeKind, type GaugeSegment, UsageGauge } from "~/components/UsageGauge";
import { StatusText } from "~/components/models/StatusText";
import { count } from "~/lib/format";
import { modelPageHref } from "~/lib/modelLinks";
import { bytes } from "~/lib/time";
import { datasetHref } from "~/pages/models/list/cells";
import type { InfrastructureInfo, StoreInfo } from "./parts";

type StoredItem = InfrastructureInfo["largest"][number];

const LOW_FREE_SHARE = 0.1;

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

function diskSegments(disk: Disk): GaugeSegment[] {
    const stored = disk.stores.map((store) => ({
        key: store.name,
        kind: CATEGORY_KIND[store.name] ?? ("other" as const),
        label: store.name,
        legend: store.name,
        bytes: store.used_bytes ?? 0,
    }));
    const used = disk.total - disk.free;
    const ours = stored.reduce((sum, segment) => sum + segment.bytes, 0);
    return [
        ...stored,
        {
            key: "other",
            kind: "other",
            label: "Other files on the disk",
            bytes: Math.max(0, used - ours),
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

function DiskCard({ disk }: { disk: Disk }) {
    const segments = diskSegments(disk);
    const low = disk.free / disk.total < LOW_FREE_SHARE;
    const where = commonFolder(disk.stores.map((store) => store.location));
    return (
        <div className="flex min-w-0 flex-col gap-2 px-4 py-3">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <span className="min-w-0 truncate font-mono" title={where}>
                    {where}
                </span>
                <span className="text-sm tabular-nums">
                    {low ? (
                        <StatusText tone="warning">{`${bytes(disk.free)} free of ${bytes(disk.total)}`}</StatusText>
                    ) : (
                        <span className="text-muted-foreground">{`${bytes(disk.free)} free of ${bytes(disk.total)}`}</span>
                    )}
                </span>
            </div>
            <UsageGauge segments={segments} capacity={disk.total} label="Disk use" />
        </div>
    );
}

const STORE_COLUMNS: ColumnDef<StoreInfo, unknown>[] = [
    { header: "Holds", accessorKey: "name" },
    { header: "Kind", id: "kind", cell: ({ row }) => STORE_KIND[row.original.kind] },
    {
        header: "Where",
        id: "location",
        cell: ({ row }) => (
            <Tooltip>
                <TooltipTrigger asChild>
                    <span className="block max-w-72 truncate font-mono">
                        {row.original.location}
                    </span>
                </TooltipTrigger>
                <TooltipContent className="max-w-96 font-mono break-all">
                    {row.original.location}
                </TooltipContent>
            </Tooltip>
        ),
    },
    {
        header: "Used",
        id: "used",
        cell: ({ row }) => <span className="tabular-nums">{bytes(row.original.used_bytes)}</span>,
    },
];

function itemHref(item: StoredItem): string {
    return item.kind === "model" ? modelPageHref(item.key) : datasetHref(item.key);
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
    {
        header: "Kind",
        id: "kind",
        cell: ({ row }) => (row.original.kind === "model" ? "Model files" : "Dataset versions"),
    },
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
            icon={HardDrive}
            title="Disks"
            description="What minibrain keeps on each disk, and what is left."
        >
            {disks.length === 0 ? (
                <p className="px-4 py-3 text-muted-foreground">No store is on a local disk.</p>
            ) : (
                <div className="flex flex-col divide-y">
                    {disks.map((disk) => (
                        <DiskCard key={disk.key} disk={disk} />
                    ))}
                </div>
            )}
        </PanelSection>
    );
}

function StoresSection({ info }: { info: InfrastructureInfo | undefined }) {
    return (
        <PanelSection bare icon={Layers} title="Stores">
            <div className="flex flex-col gap-3">
                <DataGrid columns={STORE_COLUMNS} rows={info?.stores ?? []} />
                <p className="text-sm text-muted-foreground">
                    Everything lives under{" "}
                    <span className="font-mono text-foreground">{info?.home ?? "…"}</span>. To move
                    the install, set{" "}
                    <span className="font-mono text-foreground">MINIBRAIN_HOME</span> before
                    starting minibrain.
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
            icon={FileStack}
            title="Largest items"
            description="Base model files on main and each dataset's saved versions, biggest first."
        >
            <DataGrid columns={ITEM_COLUMNS} rows={items} empty="Nothing stored yet." />
        </PanelSection>
    );
}

function VersionUsageSection({ info }: { info: InfrastructureInfo | undefined }) {
    const usage = info?.dataset_versions;
    return (
        <PanelSection
            icon={Archive}
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

export function StorageTab({ info }: { info: InfrastructureInfo | undefined }) {
    return (
        <PanelSections>
            <StorageSection info={info} />
            <LargestSection info={info} />
            <StoresSection info={info} />
            <VersionUsageSection info={info} />
        </PanelSections>
    );
}
