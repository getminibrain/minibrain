import type { GaugeKind, GaugeSegment } from "~/components/UsageGauge";
import type { StoreInfo } from "./parts";

const CATEGORY_KIND: Record<string, GaugeKind> = {
    Database: "database",
    "Model files": "weights",
    "Dataset versions": "datasets",
    "Uploads, adapters and results": "uploads",
};

const LOW_FREE_SHARE = 0.1;
const LOW_FREE_BYTES = 10 * 1024 ** 3;

export type Disk = { key: string; free: number; total: number; stores: StoreInfo[] };

export function disksOf(stores: StoreInfo[]): Disk[] {
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

export function shareSegments(disk: Disk): GaugeSegment[] {
    return disk.stores.map((store) => ({
        key: store.name,
        kind: CATEGORY_KIND[store.name] ?? "other",
        label: store.name,
        legend: store.name,
        bytes: store.used_bytes ?? 0,
    }));
}

export function diskSegments(free: number, total: number, ours: number): GaugeSegment[] {
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

export function lowSpace(free: number, total: number): boolean {
    return total > 0 && (free < LOW_FREE_BYTES || free / total < LOW_FREE_SHARE);
}
