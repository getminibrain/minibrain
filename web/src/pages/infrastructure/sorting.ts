import { type Problem, problemsOfMachine } from "~/api/problemQueries";
import {
    capacityOf,
    cpuOf,
    gpuCount,
    machineStatuses,
    memoryOf,
    modelChips,
    ramOf,
    shareOf,
} from "./fleet";
import type { MachineRow } from "./machines";

export type SortKey = "host" | "status" | "gpu" | "memory" | "cpu" | "ram" | "running";

export type Sort = { key: SortKey; desc: boolean };

type SortValue = number | string | null;

const ASCENDING_FIRST: SortKey[] = ["host", "gpu"];

function sortValue(row: MachineRow, key: SortKey, problems: Problem[] | undefined): SortValue {
    const { node } = row;
    const values: Record<SortKey, () => SortValue> = {
        host: () => node.host,
        status: () => machineStatuses(row, problemsOfMachine(problems, node.id))[0].rank,
        gpu: () => gpuCount(node) * 1000 + (capacityOf(node) ?? 0) / 1024 ** 3,
        memory: () => {
            const memory = memoryOf(row);
            return memory ? shareOf(memory.used, memory.capacity) : null;
        },
        cpu: () => cpuOf(node),
        ram: () => {
            const ram = ramOf(node);
            return ram.used !== null && ram.total ? ram.used / ram.total : null;
        },
        running: () => (node.online ? modelChips(row).length + node.jobs.length : null),
    };
    return values[key]();
}

function compare(a: SortValue, b: SortValue, direction: number): number {
    if (a === null || b === null) {
        return a === b ? 0 : a === null ? 1 : -1;
    }
    const order =
        typeof a === "string" && typeof b === "string" ? a.localeCompare(b) : Number(a) - Number(b);
    return order * direction;
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
    return [...rows].sort((left, right) =>
        compare(
            sortValue(left, sort.key, problems),
            sortValue(right, sort.key, problems),
            direction,
        ),
    );
}

export function nextSort(current: Sort | null, key: SortKey): Sort | null {
    const descFirst = !ASCENDING_FIRST.includes(key);
    if (current?.key !== key) {
        return { key, desc: descFirst };
    }
    return current.desc === descFirst ? { key, desc: !current.desc } : null;
}
