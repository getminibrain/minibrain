import type { Problem } from "~/api/problemQueries";
import type { GaugeBasis } from "~/components/UsageGauge";
import type { Tone } from "~/components/models/StatusText";
import { bytes } from "~/lib/time";
import {
    type EngineState,
    type NodeJob,
    engineLabel,
    engineState,
    jobLink,
    jobSubject,
    memoryView,
    servedHref,
} from "./activity";
import { servedOn } from "./byModel";
import { type MachineRow, machineStatus } from "./machines";
import type { NodeInfo } from "./parts";

export function shortGpu(name: string): string {
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

export type Memory = { capacity: number; used: number; basis: GaugeBasis };

export function memoryOf(row: MachineRow): Memory | null {
    const view = memoryView(row.node, row.engines);
    return view ? { capacity: view.capacity, used: view.used, basis: view.basis } : null;
}

export function shareOf(used: number, capacity: number): number {
    return capacity > 0 ? used / capacity : 0;
}

export function percentText(fraction: number): string {
    return `${Math.round(Math.min(fraction, 9.99) * 100)}%`;
}

export function memoryText(used: number, capacity: number): string {
    return `${bytes(used)} of ${bytes(capacity)}`;
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

export function agoText(value: string | null | undefined, now: number = Date.now()): string {
    if (!value) {
        return "never";
    }
    const seconds = Math.max(0, (now - new Date(value).getTime()) / 1000);
    for (const [size, unit] of UNITS) {
        if (seconds >= size) {
            return `${Math.floor(seconds / size)}${unit} ago`;
        }
    }
    return "now";
}

export type Chip = {
    key: string;
    name: string;
    model: string;
    version: number | null | undefined;
    href: string;
    state: EngineState;
    detail: string;
};

export function modelChips(row: MachineRow): Chip[] {
    const { models, bare } = servedOn(row.engines);
    const served = models.map(({ served, engines }) => {
        const states = engines.map((engine) => engineState(engine.state));
        const worst = states.find((state) => state.tone !== "success") ?? states[0];
        return {
            key: `served-${served.model}`,
            name: served.name,
            model: served.model,
            version: served.version,
            href: servedHref(served),
            state: worst,
            detail: `${worst.label} · ${engineLabel(engines[0].engine)} on ${engines[0].base_model}`,
        };
    });
    const engines = bare.map((engine) => ({
        key: `engine-${engine.id}`,
        name: engine.base_model,
        model: engine.base_model,
        version: null,
        href: "",
        state: engineState(engine.state),
        detail: `${engineState(engine.state).label} · ${engineLabel(engine.engine)}, no model deployed`,
    }));
    return [...served, ...engines];
}

export type JobChip = { key: string; job: NodeJob; subject: string; href: string };

export function jobChips(node: NodeInfo): JobChip[] {
    return node.jobs.map((job) => ({
        key: `job-${job.id}`,
        job,
        subject: jobSubject(job),
        href: jobLink(job),
    }));
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
    };
}

export function statusTone(row: MachineRow): { label: string; tone: Tone; active: boolean } {
    const status = machineStatus(row.node, row.engines);
    return { label: status.label, tone: status.tone, active: status.active ?? false };
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

export function problemLabel(problem: Problem): string {
    return PROBLEM_LABELS[problem.kind] ?? problem.subject;
}

export function problemTone(problems: Problem[]): "destructive" | "warning" {
    return problems.some((problem) => problem.severity === "critical") ? "destructive" : "warning";
}
