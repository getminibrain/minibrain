import type { Tone } from "~/components/models/StatusText";
import { bytes } from "~/lib/time";
import { differences, lowDiskText, lowSpace, lowStores } from "./NeedsALook";
import type { InfrastructureInfo, NodeInfo, PoolInfo, ReplicaInfo, StoreInfo } from "./parts";

export type MachineRow = {
    node: NodeInfo;
    pool: PoolInfo;
    engines: ReplicaInfo[];
};

export type ProblemKind = "versions" | "engine" | "disk";

export type Problem = {
    kind: ProblemKind;
    tone: "warning" | "destructive";
    label: string;
    reason: string;
};

export type MachineFilters = {
    status: string[];
    pool: string[];
    role: string[];
    accelerator: string[];
    q: string;
};

export const STATUSES = [
    { value: "online", label: "Online" },
    { value: "draining", label: "Draining" },
    { value: "offline", label: "Offline" },
];

export type LowDisk = { key: string; name: string; mount: string | null; free_bytes: number };

export type MachineStatus = { label: string; tone: Tone; active?: boolean };

export function busyOf(node: NodeInfo, engines: ReplicaInfo[]): boolean {
    return node.jobs.length > 0 || engines.length > 0;
}

export function machineStatus(node: NodeInfo, engines: ReplicaInfo[]): MachineStatus {
    if (node.state === "draining") {
        const busy = busyOf(node, engines);
        const label = busy ? "Draining" : "Drained";
        return {
            label: node.online ? label : `${label}, offline`,
            tone: "warning",
            active: busy && node.online,
        };
    }
    return node.online
        ? { label: "Online", tone: "success" }
        : { label: "Offline", tone: "neutral" };
}

export const ROLES = [
    { value: "main", label: "Main" },
    { value: "worker", label: "Worker" },
    { value: "engine", label: "Engine" },
];

export function statusOf(node: NodeInfo): string {
    if (node.state === "draining") {
        return "draining";
    }
    return node.online ? "online" : "offline";
}

export function acceleratorOf(node: NodeInfo): string {
    if (node.gpus.length > 0) {
        return node.gpus[0].name;
    }
    return node.accelerator === "cpu" ? "CPU only" : node.accelerator_name || node.accelerator;
}

export type HardwareFacts = Pick<NodeInfo, "gpus" | "accelerator_name" | "ram_bytes">;

export function hardwareParts(node: HardwareFacts): { device: string; memory: string | null } {
    if (node.gpus.length === 0) {
        return {
            device: node.accelerator_name || "CPU",
            memory: node.ram_bytes ? `${bytes(node.ram_bytes)} RAM` : null,
        };
    }
    const names = new Map<string, number>();
    for (const gpu of node.gpus) {
        names.set(gpu.name, (names.get(gpu.name) ?? 0) + 1);
    }
    const device = [...names.entries()]
        .map(([name, count]) => (count > 1 ? `${count} × ${name}` : name))
        .join(" + ");
    return { device, memory: bytes(node.gpus.reduce((sum, gpu) => sum + gpu.memory_bytes, 0)) };
}

export function hardwareText(node: HardwareFacts): string {
    const { device, memory } = hardwareParts(node);
    return memory ? `${device} · ${memory}` : device;
}

export function machineRows(pools: PoolInfo[]): MachineRow[] {
    return pools.flatMap((pool) =>
        [...pool.nodes]
            .sort((left, right) => Number(right.online) - Number(left.online))
            .map((node) => ({
                node,
                pool,
                engines: pool.engines.filter((engine) => engine.host === node.host),
            })),
    );
}

export function matches(row: MachineRow, filters: MachineFilters): boolean {
    const { node, pool } = row;
    const text = filters.q.trim().toLowerCase();
    return (
        (filters.status.length === 0 || filters.status.includes(statusOf(node))) &&
        (filters.pool.length === 0 || filters.pool.includes(pool.name)) &&
        (filters.role.length === 0 || node.roles.some((role) => filters.role.includes(role))) &&
        (filters.accelerator.length === 0 || filters.accelerator.includes(acceleratorOf(node))) &&
        (text === "" || node.host.toLowerCase().includes(text))
    );
}

export function versionDrift(node: NodeInfo, main: Record<string, string>): string[] {
    return node.roles.includes("main") ? [] : differences(node.versions ?? {}, main);
}

export function failedEngines(row: MachineRow): ReplicaInfo[] {
    return row.engines.filter((engine) => engine.state === "failed");
}

export function lowDiskOf(node: NodeInfo, info: InfrastructureInfo | undefined): LowDisk[] {
    if (node.roles.includes("main")) {
        return lowStores(info).map((store: StoreInfo) => ({
            key: store.name,
            name: store.name,
            mount: store.mount ?? null,
            free_bytes: store.free_bytes ?? 0,
        }));
    }
    return (node.disks ?? [])
        .filter((disk) => lowSpace(disk.free_bytes, disk.total_bytes))
        .map((disk) => ({
            key: disk.path,
            name: disk.path,
            mount: disk.mount ?? disk.path,
            free_bytes: disk.free_bytes ?? 0,
        }));
}

export function problemsOf(
    row: MachineRow,
    main: Record<string, string>,
    info: InfrastructureInfo | undefined,
): Problem[] {
    const drift = versionDrift(row.node, main);
    const failed = failedEngines(row);
    const low = lowDiskOf(row.node, info);
    return [
        ...failed.map((engine) => ({
            kind: "engine" as const,
            tone: "destructive" as const,
            label: "Engine failed",
            reason: `The engine for ${engine.base_model} failed`,
        })),
        ...(drift.length > 0
            ? [
                  {
                      kind: "versions" as const,
                      tone: "warning" as const,
                      label: "Versions differ",
                      reason: `Versions differ from main: ${drift.join("; ")}`,
                  },
              ]
            : []),
        ...low.map((store) => ({
            kind: "disk" as const,
            tone: "warning" as const,
            label: "Low disk",
            reason: lowDiskText(store),
        })),
    ];
}
