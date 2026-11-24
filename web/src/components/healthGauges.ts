import { estimatedView, measuredView, memorySegments } from "~/pages/infrastructure/activity";
import { diskSegments, disksOf, lowSpace, shareSegments } from "~/pages/infrastructure/disks";
import { ramOf } from "~/pages/infrastructure/fleet";
import { machineRows } from "~/pages/infrastructure/machines";
import type { InfrastructureInfo, PoolInfo } from "~/pages/infrastructure/parts";
import type { GaugeSegment } from "./UsageGauge";

export type HealthGauge = {
    label: string;
    capacity: number;
    segments: GaugeSegment[];
    low: boolean;
};

function sum(segments: GaugeSegment[]): number {
    return segments.reduce((total, segment) => total + segment.bytes, 0);
}

export function memoryGauge(pools: PoolInfo[]): HealthGauge | null {
    const main = machineRows(pools).find((row) => row.node.roles.includes("main"));
    if (!main) {
        return null;
    }
    const models = memorySegments(main.node, main.engines);
    const measured = measuredView(main.node);
    const ram = ramOf(main.node);
    const used = measured?.used ?? ram.used;
    const capacity = measured?.capacity ?? ram.total;
    if (used === null || !capacity) {
        const estimated = estimatedView(main.node, main.engines);
        return estimated
            ? {
                  label: "Memory on this machine",
                  capacity: estimated.capacity,
                  segments: estimated.segments,
                  low: false,
              }
            : null;
    }
    const rest: GaugeSegment = {
        key: "rest",
        kind: "measured",
        label: "Everything else",
        legend: "Everything else",
        bytes: Math.max(0, used - sum(models)),
    };
    return { label: "Memory on this machine", capacity, segments: [...models, rest], low: false };
}

export function diskGauge(info: InfrastructureInfo): HealthGauge | null {
    const disks = disksOf(info.stores);
    if (disks.length === 0) {
        return null;
    }
    const disk = disks.reduce((fullest, item) =>
        item.free / item.total < fullest.free / fullest.total ? item : fullest,
    );
    return {
        label: "Disk on this machine",
        capacity: disk.total,
        segments: diskSegments(disk.free, disk.total, sum(shareSegments(disk))),
        low: lowSpace(disk.free, disk.total),
    };
}
