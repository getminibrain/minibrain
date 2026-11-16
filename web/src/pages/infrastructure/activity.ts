import type { GaugeSegment } from "~/components/UsageGauge";
import { jobHref, modelPageHref, modelVersionHref } from "~/lib/modelLinks";
import type { NodeInfo, ReplicaInfo } from "./parts";

export type NodeJob = NodeInfo["jobs"][number];
export type RecentJob = NonNullable<NodeInfo["recent"]>[number];
export type Served = ReplicaInfo["serves"][number];

export const MEMORY_LABELS: Record<string, string> = {
    cuda: "GPU memory",
    rocm: "GPU memory",
    xpu: "GPU memory",
    mps: "unified memory",
};

export const ENGINE_LABELS: Record<string, string> = {
    sglang: "SGLang",
    vllm: "vLLM",
    mlx: "MLX",
    transformers: "Transformers",
    llamacpp: "llama.cpp",
};

export const ENGINE_DOING: Record<string, string> = {
    loading: "Loading",
    fetching: "Fetching weights for",
    failed: "Engine failed for",
};

export function engineLabel(engine: string): string {
    return ENGINE_LABELS[engine] ?? engine;
}

export function versioned(name: string, version: number | null | undefined): string {
    return version === null || version === undefined ? name : `${name} v${version}`;
}

export function servedHref(served: Served): string {
    return served.version === null || served.version === undefined
        ? modelPageHref(served.model)
        : modelVersionHref(served.model, served.version);
}

export function jobLink(job: {
    id: number;
    kind: string;
    model: string | null;
    version: number | null;
}): string {
    if (job.kind === "train" && job.model && job.version !== null && job.version !== undefined) {
        return modelVersionHref(job.model, job.version);
    }
    return jobHref(job);
}

export function jobSubject(job: {
    id: number;
    model: string | null;
    model_name: string | null;
    version: number | null;
}): string {
    return versioned(job.model_name ?? job.model ?? `job ${job.id}`, job.version);
}

export function memorySegments(node: NodeInfo, engines: ReplicaInfo[]): GaugeSegment[] {
    const served = engines
        .filter((engine) => engine.state !== "failed")
        .flatMap((engine) => [
            {
                key: `weights-${engine.id}`,
                label: `${engine.base_model} weights`,
                kind: "weights" as const,
                bytes: engine.weights_bytes ?? 0,
            },
            ...engine.serves
                .filter((item) => item.adapter_bytes)
                .map((item) => ({
                    key: `adapter-${engine.id}-${item.model}`,
                    label: `${versioned(item.name, item.version)} adapter`,
                    kind: "adapters" as const,
                    bytes: item.adapter_bytes ?? 0,
                })),
        ]);
    const training = node.jobs
        .filter((job) => job.memory_bytes)
        .map((job) => ({
            key: `job-${job.id}`,
            label: `Training ${jobSubject(job)}`,
            kind: "training" as const,
            bytes: job.memory_bytes ?? 0,
        }));
    return [...served, ...training];
}
