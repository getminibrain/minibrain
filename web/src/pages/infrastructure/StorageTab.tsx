import { IconCylinder, IconServer } from "@tabler/icons-react";
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

const LOW_FREE_SHARE = 0.1;
const LOW_FREE_BYTES = 10 * 1024 ** 3;

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

function lowSpace(free: number, total: number): boolean {
    return total > 0 && (free < LOW_FREE_BYTES || free / total < LOW_FREE_SHARE);
}

function usedText(free: number, total: number): string {
    return `${total > 0 ? Math.round(((total - free) / total) * 100) : 0}% used`;
}

function freeText(free: number, total: number): string {
    return `${bytes(free)} free of ${bytes(total)}`;
}

function DiskSpace({ free, total, text }: { free: number; total: number; text: string }) {
    return (
        <span className="shrink-0 text-sm tabular-nums">
            {lowSpace(free, total) ? (
                <StatusText tone="warning">{text}</StatusText>
            ) : (
                <span className="text-muted-foreground">{text}</span>
            )}
        </span>
    );
}

function PathLine({ path, label, tail = 20 }: { path: string; label: string; tail?: number }) {
    return (
        <span className="flex min-w-0 items-center gap-1 text-sm text-muted-foreground">
            <MiddleTruncate text={path} tail={tail} />
            <CopyButton value={path} label={label} />
        </span>
    );
}

function MainDisk({ disk }: { disk: Disk }) {
    const share = shareSegments(disk);
    const where = commonFolder(disk.stores.map((store) => store.location));
    const mount = disk.stores[0]?.mount ?? where;
    const ours = share.reduce((sum, segment) => sum + segment.bytes, 0);
    return (
        <div className="flex min-w-0 flex-col gap-2 px-4 py-3">
            <div className="flex min-w-0 items-baseline justify-between gap-4">
                <span className="min-w-0 truncate font-mono font-medium">{mount}</span>
                <DiskSpace
                    free={disk.free}
                    total={disk.total}
                    text={`${usedText(disk.free, disk.total)} · ${freeText(disk.free, disk.total)}`}
                />
            </div>
            <PathLine path={where} label={`Copy the path of minibrain's files on ${mount}`} />
            <UsageGauge
                size="sm"
                segments={diskSegments(disk.free, disk.total, ours)}
                capacity={disk.total}
                low={lowSpace(disk.free, disk.total)}
                label={`Disk use of ${mount}`}
            />
            {share.length > 1 && ours > 0 && (
                <div className="flex flex-col gap-2 pt-1">
                    <p className="text-sm text-muted-foreground tabular-nums">
                        {`minibrain's share · ${bytes(ours)}`}
                    </p>
                    <UsageGauge
                        size="sm"
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

function MainDisksSection({ info }: { info: InfrastructureInfo | undefined }) {
    const disks = disksOf(info?.stores ?? []);
    return (
        <PanelSection
            flush
            icon={IconCylinder}
            title="Disks on main"
            description="What minibrain keeps on each disk, and what is left."
        >
            {disks.length === 0 ? (
                <p className="px-4 py-3 text-muted-foreground">
                    {info ? "No store is on a local disk." : "…"}
                </p>
            ) : (
                <div className="flex flex-col divide-y">
                    {disks.map((disk) => (
                        <MainDisk key={disk.key} disk={disk} />
                    ))}
                </div>
            )}
        </PanelSection>
    );
}

type MachineDisk = {
    key: string;
    node: NodeInfo;
    pool: string;
    path: string;
    free: number;
    total: number;
    ours: number;
    cache: number | null | undefined;
    reported: string | null | undefined;
};

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
                                  path: disk.path,
                                  free: disk.free_bytes,
                                  total: disk.total_bytes,
                                  ours: disk.minibrain_bytes ?? 0,
                                  cache: disk.cache_bytes,
                                  reported: disk.reported_at,
                              },
                          ]
                        : [],
                ),
            ),
    );
}

function cacheText(cache: number | null | undefined): string {
    return cache === null || cache === undefined ? "cache not reported" : `cache ${bytes(cache)}`;
}

function MachineDiskRow({ disk }: { disk: MachineDisk }) {
    return (
        <div className="flex min-w-0 flex-col gap-1.5 px-4 py-2.5">
            <div className="flex min-w-0 items-baseline justify-between gap-4">
                <span className="flex min-w-0 items-baseline gap-x-2">
                    <MachineName node={disk.node} />
                    <PoolLink name={disk.pool} className="shrink-0" />
                    {!disk.node.online && disk.reported && (
                        <span className="shrink-0 text-sm text-muted-foreground">
                            {`reported ${relativeTime(disk.reported)}`}
                        </span>
                    )}
                </span>
                <DiskSpace
                    free={disk.free}
                    total={disk.total}
                    text={usedText(disk.free, disk.total)}
                />
            </div>
            <UsageGauge
                size="sm"
                legend={false}
                segments={diskSegments(disk.free, disk.total, disk.ours)}
                capacity={disk.total}
                low={lowSpace(disk.free, disk.total)}
                label={`Disk use of ${disk.node.host}`}
            />
            <div className="flex min-w-0 items-center justify-between gap-4 text-sm text-muted-foreground">
                <PathLine
                    path={disk.path}
                    tail={12}
                    label={`Copy the disk path of ${disk.node.host}`}
                />
                <span className="shrink-0 tabular-nums">
                    {`${freeText(disk.free, disk.total)} · ${cacheText(disk.cache)}`}
                </span>
            </div>
        </div>
    );
}

function MachineDisksSection({ pools }: { pools: PoolInfo[] }) {
    const disks = machineDisks(pools);
    return (
        <PanelSection
            flush
            icon={IconServer}
            title="Disks on other machines"
            description="Where each worker and engine keeps model copies, downloads and job files."
            tip="As each machine last reported. The cache holds model copies and downloads it can fetch again."
        >
            {disks.length === 0 ? (
                <p className="px-4 py-3 text-muted-foreground">
                    No other machine has reported its disk.
                </p>
            ) : (
                <div className="flex flex-col divide-y">
                    {disks.map((disk) => (
                        <MachineDiskRow key={disk.key} disk={disk} />
                    ))}
                </div>
            )}
        </PanelSection>
    );
}

function Columns({ children }: { children: ReactNode }) {
    return (
        <div className="grid items-start gap-x-panel-gap gap-y-10 xl:grid-cols-2">{children}</div>
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
            <Columns>
                <MainDisksSection info={info} />
                <MachineDisksSection pools={pools} />
            </Columns>
            <Columns>
                <UsageSection info={info} />
                <FreeUpSection info={info} />
            </Columns>
        </PanelSections>
    );
}
