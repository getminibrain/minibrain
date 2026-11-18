import { type Problem, problemsOfMachine } from "~/api/problemQueries";
import { cpuOf, gpuCount, memoryOf, modelChips, ramOf, shareOf } from "./fleet";
import type { MachineRow } from "./machines";

export type SortKey =
    | "host"
    | "pool"
    | "status"
    | "gpu"
    | "memory"
    | "cpu"
    | "ram"
    | "models"
    | "jobs";

export type Sort = { key: SortKey; desc: boolean };

const ASCENDING_FIRST: SortKey[] = ["host", "pool", "gpu"];

export function statusRank(row: MachineRow, problems: Problem[] | undefined): number {
    const found = problemsOfMachine(problems, row.node.id).filter(
        (problem) => problem.kind !== "machine_offline",
    );
    if (found.some((problem) => problem.severity === "critical")) {
        return 4;
    }
    if (found.length > 0) {
        return 3;
    }
    if (!row.node.online) {
        return 2;
    }
    return row.node.state === "draining" ? 1 : 0;
}

function sortValue(
    row: MachineRow,
    key: SortKey,
    problems: Problem[] | undefined,
): number | string {
    const { node } = row;
    const values: Record<SortKey, () => number | string> = {
        host: () => node.host,
        pool: () => `${row.pool.name}\u0000${node.host}`,
        status: () => statusRank(row, problems),
        gpu: () => gpuCount(node) * 1000 + (node.usable_bytes ?? 0) / 1024 ** 3,
        memory: () => {
            const memory = memoryOf(row);
            return memory ? shareOf(memory.used, memory.capacity) : -1;
        },
        cpu: () => cpuOf(node) ?? -1,
        ram: () => {
            const ram = ramOf(node);
            return ram.used !== null && ram.total ? ram.used / ram.total : -1;
        },
        models: () => (node.online ? modelChips(row).length : -1),
        jobs: () => node.jobs.length,
    };
    return values[key]();
}

export function sortRows(
    rows: MachineRow[],
    sort: Sort | null,
    problems?: Problem[],
): MachineRow[] {
    if (sort === null) {
        return rows;
    }
    const direction = sort.desc ? -1 : 1;
    return [...rows].sort((left, right) => {
        const a = sortValue(left, sort.key, problems);
        const b = sortValue(right, sort.key, problems);
        const order =
            typeof a === "string" && typeof b === "string"
                ? a.localeCompare(b)
                : Number(a) - Number(b);
        return order * direction;
    });
}

export function nextSort(current: Sort | null, key: SortKey): Sort | null {
    const descFirst = !ASCENDING_FIRST.includes(key);
    if (current?.key !== key) {
        return { key, desc: descFirst };
    }
    return current.desc === descFirst ? { key, desc: !current.desc } : null;
}
