import type { JobDetail, JobMetrics, TrainingMetrics } from "~/api/client";
import { count } from "~/lib/format";

export type Previous = NonNullable<JobMetrics["previous"]>;
export type Training = NonNullable<NonNullable<JobDetail["setup"]>["training"]>;
export type Point = TrainingMetrics["points"][number];
export type Held = TrainingMetrics["evals"][number];

export type CurveRow = {
    step: number;
    loss: number | null;
    smooth: number | null;
    eval_loss: number | null;
    previous: number | null;
    previous_eval: number | null;
    rate: number | null;
};

export type Verdict = {
    kind: "overfit" | "waiting" | "single" | "flat" | "falling";
    text: string;
};

export const SMOOTHING = 0.6;
const DEFAULT_WARMUP = 0.05;
const FLAT = 0.01;

export function lastStep(points: readonly { step: number }[]): number {
    return points.at(-1)?.step ?? 0;
}

export function domainEnd(
    training: TrainingMetrics,
    previous: Previous | null | undefined,
): number {
    const own = Math.max(lastStep(training.points), lastStep(training.evals));
    if (training.steps) {
        return Math.max(training.steps, own);
    }
    return Math.max(own, lastStep(previous?.points ?? []));
}

export function smoothed(points: readonly Point[]): Map<number, number> {
    const result = new Map<number, number>();
    let value = 0;
    let weight = 0;
    for (const point of points) {
        if (typeof point.loss !== "number") {
            continue;
        }
        value = SMOOTHING * value + (1 - SMOOTHING) * point.loss;
        weight = SMOOTHING * weight + (1 - SMOOTHING);
        result.set(point.step, value / weight);
    }
    return result;
}

export function curveRows(
    training: TrainingMetrics,
    previous: Previous | null | undefined,
    end: number,
    smoothPrevious: boolean,
): CurveRow[] {
    const rows = new Map<number, CurveRow>();
    const row = (step: number) => {
        const found = rows.get(step) ?? {
            step,
            loss: null,
            smooth: null,
            eval_loss: null,
            previous: null,
            previous_eval: null,
            rate: null,
        };
        rows.set(step, found);
        return found;
    };
    const smooth = smoothed(training.points);
    for (const point of training.points) {
        const found = row(point.step);
        found.loss = point.loss ?? null;
        found.smooth = smooth.get(point.step) ?? null;
        found.rate = point.learning_rate ?? null;
    }
    for (const point of training.evals) {
        row(point.step).eval_loss = point.eval_loss;
    }
    const earlier = smoothPrevious ? smoothed(previous?.points ?? []) : null;
    for (const point of previous?.points ?? []) {
        if (point.step <= end) {
            row(point.step).previous = earlier
                ? (earlier.get(point.step) ?? null)
                : (point.loss ?? null);
        }
    }
    for (const point of previous?.evals ?? []) {
        if (point.step <= end) {
            row(point.step).previous_eval = point.eval_loss;
        }
    }
    return [...rows.values()].sort((left, right) => left.step - right.step);
}

export function nearest<T extends { step: number }>(items: readonly T[], step: number): T | null {
    if (items.length === 0) {
        return null;
    }
    let low = 0;
    let high = items.length - 1;
    while (low < high) {
        const middle = (low + high) >> 1;
        if (items[middle].step < step) {
            low = middle + 1;
        } else {
            high = middle;
        }
    }
    const after = items[low];
    const before = items[low - 1];
    return before && step - before.step <= Math.abs(after.step - step) ? before : after;
}

export function warmupEnd(training: TrainingMetrics, setup: Training | null | undefined): number {
    const steps = training.steps;
    if (!steps) {
        return 0;
    }
    const ratio = setup?.warmup ?? DEFAULT_WARMUP;
    return ratio > 0 ? Math.max(1, Math.floor(ratio * steps + 0.5)) : 0;
}

function recordedBoundaries(points: readonly Point[]): number[] {
    const boundaries: number[] = [];
    let epoch: number | null = null;
    for (const point of points) {
        if (typeof point.epoch !== "number") {
            continue;
        }
        const whole = Math.floor(point.epoch + 1e-6);
        if (epoch !== null && whole > epoch) {
            boundaries.push(point.step);
        }
        epoch = whole;
    }
    return boundaries;
}

export function epochBoundaries(
    training: TrainingMetrics,
    setup: Training | null | undefined,
): number[] {
    const epochs = setup?.epochs;
    const steps = training.steps;
    if (!steps || !epochs) {
        return recordedBoundaries(training.points);
    }
    const perEpoch = steps / epochs;
    return Array.from({ length: Math.max(0, Math.ceil(epochs) - 1) }, (_, index) =>
        Math.round(perEpoch * (index + 1)),
    );
}

export function epochAt(
    training: TrainingMetrics,
    setup: Training | null | undefined,
    step: number,
): number | null {
    const point = nearest(training.points, step);
    if (point?.step === step && typeof point.epoch === "number") {
        return point.epoch;
    }
    if (training.steps && setup?.epochs) {
        return (step / training.steps) * setup.epochs;
    }
    return typeof point?.epoch === "number" ? point.epoch : null;
}

export function bestHeld(evals: readonly Held[]): Held | null {
    return evals.reduce<Held | null>(
        (best, point) => (best === null || point.eval_loss < best.eval_loss ? point : best),
        null,
    );
}

export function flattenedAt(evals: readonly Held[]): number | null {
    for (let index = 0; index < evals.length - 1; index += 1) {
        const later = Math.min(...evals.slice(index + 1).map((point) => point.eval_loss));
        if (later >= evals[index].eval_loss * (1 - FLAT)) {
            return evals[index].step;
        }
    }
    return null;
}

export function verdict(training: TrainingMetrics, active: boolean): Verdict {
    if (training.rising_from !== null && training.rising_from !== undefined) {
        return {
            kind: "overfit",
            text: `Overfitting from step ${count(training.rising_from)}: fewer epochs or more dropout may help`,
        };
    }
    const evals = training.evals;
    if (evals.length === 0) {
        return {
            kind: "waiting",
            text: active
                ? "Waiting for the first held-out check"
                : "This run made no held-out checks",
        };
    }
    if (evals.length === 1) {
        return {
            kind: "single",
            text: `${active ? "One held-out check so far" : "One held-out check"}, at step ${count(evals[0].step)}`,
        };
    }
    const flat = flattenedAt(evals);
    if (flat !== null) {
        return { kind: "flat", text: `Held-out loss flattened at step ${count(flat)}` };
    }
    return { kind: "falling", text: "Held-out loss still falling" };
}
