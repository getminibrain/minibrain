import type { ColumnDef } from "@tanstack/react-table";
import { Archive, Eraser, FileStack, HardDrive, Layers } from "lucide-react";
import { DataGrid, Link } from "obp-ui";
import type { ReactNode } from "react";
import { CopyButton } from "~/components/CopyButton";
import { MiddleTruncate } from "~/components/MiddleTruncate";
import { PanelSection, PanelSections, Stat } from "~/components/Section";
import { type GaugeKind, type GaugeSegment, UsageGauge } from "~/components/UsageGauge";
import { StatusText } from "~/components/models/StatusText";
import { count } from "~/lib/format";
import { JOBS_PATH, modelPageHref, modelVersionHref } from "~/lib/modelLinks";
import { bytes } from "~/lib/time";
import { datasetHref } from "~/pages/models/list/cells";
import { lowSpace } from "./NeedsALook";
import { type InfrastructureInfo, type StoreInfo, plural } from "./parts";

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

function diskSegments(disk: Disk, ours: number): GaugeSegment[] {
    return [
        { key: "minibrain", kind: "minibrain", label: "minibrain", bytes: ours },
        {
            key: "other",
            kind: "other",
            label: "Other files on the disk",
            bytes: Math.max(0, disk.total - disk.free - ours),
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
    const share = shareSegments(disk);
    const ours = share.reduce((sum, segment) => sum + segment.bytes, 0);
    const low = lowSpace(disk.free, disk.total);
    const where = commonFolder(disk.stores.map((store) => store.location));
    const mount = disk.stores[0]?.mount ?? where;
    const free = `${bytes(disk.free)} free of ${bytes(disk.total)}`;
    return (
        <div className="flex min-w-0 flex-col gap-3 px-4 py-3">
            <div className="flex min-w-0 flex-col gap-0.5">
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                    <span className="min-w-0 truncate font-mono font-medium">{mount}</span>
                    <span className="text-sm tabular-nums">
                        {low ? (
                            <StatusText tone="warning">{free}</StatusText>
                        ) : (
                            <span className="text-muted-foreground">{free}</span>
                        )}
                    </span>
                </div>
                <MiddleTruncate text={where} className="text-sm text-muted-foreground" />
            </div>
            <UsageGauge
                segments={diskSegments(disk, ours)}
                capacity={disk.total}
                low={low}
                label={`Disk use of ${mount}`}
            />
            {ours > 0 && (
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
            icon={Eraser}
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
        <PanelSection bare icon={Layers} title="Stores">
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
            icon={FileStack}
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
            <FreeUpSection info={info} />
            <LargestSection info={info} />
            <StoresSection info={info} />
            <VersionUsageSection info={info} />
        </PanelSections>
    );
}
