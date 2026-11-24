import { IconCylinder, IconServer } from "@tabler/icons-react";
import { CopyButton } from "~/components/CopyButton";
import { MiddleTruncate } from "~/components/MiddleTruncate";
import { PoolLink } from "~/components/PoolLink";
import { PanelColumns, PanelSection, PanelSections } from "~/components/Section";
import { UsageGauge } from "~/components/UsageGauge";
import { bytes, relativeTime } from "~/lib/time";
import { FreeUpSection } from "./FreeUpSection";
import { UsageSection } from "./UsageSection";
import { type Disk, diskSegments, disksOf, lowSpace, shareSegments } from "./disks";
import { type InfrastructureInfo, MachineName, type NodeInfo, type PoolInfo } from "./parts";

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
            <span className="min-w-0 truncate font-mono font-medium">{mount}</span>
            <PathLine path={where} label={`Copy the path of minibrain's files on ${mount}`} />
            <UsageGauge
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
            </div>
            <UsageGauge
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
                <span className="shrink-0 tabular-nums">{cacheText(disk.cache)}</span>
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

export function StorageTab({
    info,
    pools,
}: {
    info: InfrastructureInfo | undefined;
    pools: PoolInfo[];
}) {
    return (
        <PanelSections>
            <PanelColumns>
                <MainDisksSection info={info} />
                <MachineDisksSection pools={pools} />
            </PanelColumns>
            <PanelColumns>
                <UsageSection info={info} />
                <FreeUpSection info={info} />
            </PanelColumns>
        </PanelSections>
    );
}
