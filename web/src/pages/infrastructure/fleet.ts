import type { Problem } from "~/api/problemQueries";
import type { GaugeBasis } from "~/components/UsageGauge";
import type { Tone } from "~/components/models/StatusText";
import { kindNoun } from "~/lib/jobs";
import { jobHref } from "~/lib/modelLinks";
import { exactTime } from "~/lib/time";
import {
    type EngineState,
    type NodeJob,
    engineLabel,
    engineState,
    jobSubject,
    memoryView,
    servedHref,
} from "./activity";
import { servedOn } from "./byModel";
import { type MachineRow, machineStatus } from "./machines";
import { type NodeInfo, plural } from "./parts";

function shortGpu(name: string): string {
    return name
        .replace(/^NVIDIA\s+/i, "")
        .replace(/-(SXM\d?|PCIE|NVL)\b/gi, "")
        .replace(/\s+Generation$/i, "")
        .replace(/-(\d+GB)$/i, " $1");
}

function briefGpu(name: string): string {
    return shortGpu(name)
        .replace(/\s*\d+\s?GB\b.*$/i, "")
        .replace(/\s+Ada$/i, "");
}

function tally(names: string[]): [string, number][] {
    const found = new Map<string, number>();
    for (const name of names) {
        found.set(name, (found.get(name) ?? 0) + 1);
    }
    return [...found.entries()];
}

function counted(names: string[], separator: string): string {
    return tally(names)
        .map(([name, many]) => (many > 1 ? `${many} × ${name}` : name))
        .join(separator);
}

export function gpuText(node: NodeInfo, brief = false): string {
    if (node.gpus.length === 0) {
        return node.accelerator === "cpu" ? "CPU only" : node.accelerator_name || "CPU";
    }
    return counted(
        node.gpus.map((gpu) => (brief ? briefGpu(gpu.name) : shortGpu(gpu.name))),
        " + ",
    );
}

export function gpuCount(node: NodeInfo): number {
    return node.accelerator === "cpu" ? 0 : node.gpus.length;
}

export type GpuShare = { index: number; used: number; capacity: number };

export type Memory = { capacity: number; used: number; basis: GaugeBasis; gpus: GpuShare[] };

function gpuShares(node: NodeInfo): GpuShare[] {
    const samples = node.online ? (node.metrics?.gpus ?? []) : [];
    const shares = samples.flatMap((gpu) =>
        gpu.memory_total_bytes && typeof gpu.memory_used_bytes === "number"
            ? [{ index: gpu.index, used: gpu.memory_used_bytes, capacity: gpu.memory_total_bytes }]
            : [],
    );
    if (shares.length < 2 || shares.length !== samples.length) {
        return [];
    }
    return shares.sort((left, right) => left.index - right.index);
}

export function memoryOf(row: MachineRow): Memory | null {
    const view = memoryView(row.node, row.engines);
    return view
        ? {
              capacity: view.capacity,
              used: view.used,
              basis: view.basis,
              gpus: view.basis === "measured" ? gpuShares(row.node) : [],
          }
        : null;
}

export function capacityOf(node: NodeInfo): number | null {
    const total = node.gpus.reduce((sum, gpu) => sum + gpu.memory_bytes, 0);
    return node.usable_bytes ?? (total > 0 ? total : null);
}

export function shareOf(used: number, capacity: number): number {
    return capacity > 0 ? used / capacity : 0;
}

export function percentText(fraction: number): string {
    return `${Math.round(Math.min(fraction, 9.99) * 100)}%`;
}

const UNIT_SIZES: [number, string][] = [
    [1024 ** 4, "TB"],
    [1024 ** 3, "GB"],
    [1024 ** 2, "MB"],
];

function unitOf(value: number): [number, string] {
    return UNIT_SIZES.find(([size]) => value >= size) ?? UNIT_SIZES[UNIT_SIZES.length - 1];
}

function amount(value: number): string {
    return String(value < 10 ? Math.round(value * 10) / 10 : Math.round(value));
}

export function memoryPair(used: number, capacity: number, separator = " / "): string {
    const [size, unit] = unitOf(capacity);
    return `${amount(used / size)}${separator}${amount(capacity / size)} ${unit}`;
}

export function sizeText(value: number): string {
    const [size, unit] = unitOf(value);
    return `${amount(value / size)} ${unit}`;
}

export function ramOf(node: NodeInfo): { used: number | null; total: number | null } {
    const metrics = node.online ? node.metrics : null;
    return {
        used: metrics?.ram_used_bytes ?? null,
        total: metrics?.ram_total_bytes ?? node.ram_bytes,
    };
}

export function cpuOf(node: NodeInfo): number | null {
    return node.online ? (node.metrics?.cpu_percent ?? null) : null;
}

const UNITS: [number, string][] = [
    [86400, "d"],
    [3600, "h"],
    [60, "m"],
];

function sinceText(value: string | null | undefined, now: number = Date.now()): string {
    if (!value) {
        return "";
    }
    const seconds = Math.max(0, (now - new Date(value).getTime()) / 1000);
    const found = UNITS.find(([size]) => seconds >= size);
    return found ? `${Math.floor(seconds / found[0])}${found[1]}` : "";
}

export type Chip = {
    key: string;
    name: string;
    model: string;
    version: number | null | undefined;
    href: string;
    state: EngineState;
    where: string;
    detail: string;
};

export function modelChips(row: MachineRow): Chip[] {
    const { models, bare } = servedOn(row.engines);
    const served = models.map(({ served, engines }) => {
        const states = engines.map((engine) => engineState(engine.state));
        const worst = states.find((state) => state.tone !== "success") ?? states[0];
        const where = `${engineLabel(engines[0].engine)} on ${engines[0].base_model}`;
        return {
            key: `served-${served.model}`,
            name: served.name,
            model: served.model,
            version: served.version,
            href: servedHref(served),
            state: worst,
            where,
            detail: `${worst.label} · ${where}`,
        };
    });
    const engines = bare.map((engine) => ({
        key: `engine-${engine.id}`,
        name: engine.base_model,
        model: engine.base_model,
        version: null,
        href: "",
        state: engineState(engine.state),
        where: `${engineLabel(engine.engine)}, no model deployed`,
        detail: `${engineState(engine.state).label} · ${engineLabel(engine.engine)}, no model deployed`,
    }));
    return [...served, ...engines];
}

export type JobChip = {
    key: string;
    job: NodeJob;
    subject: string;
    href: string;
    done: string;
    tip: string;
};

export function jobChips(node: NodeInfo): JobChip[] {
    return node.jobs.map((job) => {
        const subject = jobSubject(job);
        const done = `${Math.round(job.progress * 100)}%`;
        return {
            key: `job-${job.id}`,
            job,
            subject,
            href: jobHref(job),
            done,
            tip: `${kindNoun(job.kind)} · ${subject} · ${done} · job ${job.id}`,
        };
    });
}

export function runningText(models: number, jobs: number): string {
    return [models > 0 ? plural(models, "model") : "", jobs > 0 ? plural(jobs, "job") : ""]
        .filter((part) => part !== "")
        .join(" · ");
}

export function poolMemory(rows: MachineRow[]): Memory | null {
    const memory = rows
        .filter((row) => row.node.online)
        .map(memoryOf)
        .filter((item): item is Memory => item !== null);
    if (memory.length === 0) {
        return null;
    }
    return {
        capacity: memory.reduce((sum, item) => sum + item.capacity, 0),
        used: memory.reduce((sum, item) => sum + item.used, 0),
        basis: memory.every((item) => item.basis === "measured") ? "measured" : "estimated",
        gpus: [],
    };
}

export function offlineCapacity(rows: MachineRow[]): number | null {
    const total = rows
        .filter((row) => !row.node.online)
        .reduce((sum, row) => sum + (capacityOf(row.node) ?? 0), 0);
    return total > 0 ? total : null;
}

export type StatusItem = {
    key: string;
    label: string;
    tone: Tone;
    active: boolean;
    tip: string;
    rank: number;
};

const LOADING = ["loading", "fetching"];

function problemItem(problem: Problem): StatusItem {
    const critical = problem.severity === "critical";
    return {
        key: problem.id,
        label: problemLabel(problem),
        tone: critical ? "destructive" : "warning",
        active: false,
        tip: problem.text,
        rank: critical ? 5 : 3,
    };
}

function stateItems(row: MachineRow): StatusItem[] {
    const { node, engines } = row;
    if (!node.online) {
        const since = sinceText(node.seen_at);
        return [
            {
                key: "offline",
                label: since ? `Offline ${since}` : "Offline",
                tone: "neutral",
                active: false,
                tip: node.seen_at
                    ? `Offline, last seen ${exactTime(node.seen_at)}`
                    : "Offline, never reported",
                rank: 4,
            },
        ];
    }
    const items: StatusItem[] = [];
    if (node.state === "draining") {
        const status = machineStatus(node, engines);
        items.push({
            key: "draining",
            label: status.label,
            tone: "warning",
            active: status.active ?? false,
            tip: `${status.label}: takes no new work; what runs there now finishes.`,
            rank: 2,
        });
    }
    const loading = engines.filter((engine) => LOADING.includes(engine.state));
    if (loading.length > 0) {
        items.push({
            key: "loading",
            label: "Loading",
            tone: "info",
            active: true,
            tip: `Loading ${[...new Set(loading.map((engine) => engine.base_model))].join(", ")}`,
            rank: 1,
        });
    }
    return items;
}

const READY: StatusItem = {
    key: "ready",
    label: "Ready",
    tone: "success",
    active: false,
    tip: "Online, nothing wrong.",
    rank: 0,
};

export function machineStatuses(row: MachineRow, problems: Problem[]): StatusItem[] {
    const items = [
        ...problems.filter((problem) => problem.kind !== "machine_offline").map(problemItem),
        ...stateItems(row),
    ].sort((left, right) => right.rank - left.rank);
    return items.length > 0 ? items : [READY];
}

export function poolProblems(problems: Problem[] | undefined, pool: string): Problem[] {
    return (problems ?? []).filter((problem) => problem.pool === pool && !problem.machine);
}

const PROBLEM_LABELS: Record<Problem["kind"], string> = {
    audit_chain_broken: "Audit chain broken",
    siem_behind: "SIEM behind",
    model_down: "Model down",
    engine_failed: "Engine failed",
    disk_low: "Disk low",
    version_mismatch: "Version drift",
    training_failed: "Training failed",
    machine_offline: "Offline",
};

function problemLabel(problem: Problem): string {
    return PROBLEM_LABELS[problem.kind] ?? problem.subject;
}
