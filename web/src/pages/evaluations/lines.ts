import type { ModelRow, ModelVersionRow } from "~/api/client";
import { pointsSize } from "~/lib/format";

export type Line = { model: ModelRow; version: ModelVersionRow; live: ModelVersionRow | undefined };

export type Rank = "ready" | "regression" | "other";

export type Group = { model: ModelRow; summary: Line; lines: Line[]; rank: Rank };

const RANK_ORDER: Record<Rank, number> = { ready: 0, regression: 1, other: 2 };

export function linesOf(rows: ModelRow[]): Line[] {
    return rows
        .filter((row) => row.kind === "custom")
        .flatMap((model) => {
            const versions = model.versions ?? [];
            const live = versions.find((version) => version.live);
            return versions.map((version) => ({ model, version, live }));
        });
}

export function lineKey(line: Line): string {
    return `${line.model.key}@${line.version.number}`;
}

export function change(line: Line): number | null {
    const { version, live } = line;
    if (!live || live === version || version.score === null || live.score === null) {
        return null;
    }
    return version.metric === live.metric ? version.score - live.score : null;
}

export function moved(line: Line): "better" | "worse" | "same" | null {
    const delta = change(line);
    if (delta === null) {
        return null;
    }
    if (pointsSize(delta) === "0.0") {
        return "same";
    }
    return delta > 0 ? "better" : "worse";
}

export function scored(version: ModelVersionRow): boolean {
    return version.status === "ready" && version.score !== null;
}

export function scoredTime(version: ModelVersionRow): number {
    return Date.parse(version.scored_at ?? version.created_at);
}

function newestFirst(left: Line, right: Line): number {
    return right.version.number - left.version.number;
}

export function rankOf(line: Line): Rank {
    const { version, live } = line;
    const direction = moved(line);
    if (!scored(version) || version.live) {
        return "other";
    }
    if (direction === "worse") {
        return "regression";
    }
    const unrivalled = !live || live.score === null;
    const passes = Boolean(version.promotion?.passed) && !version.base_refusal;
    return passes && (direction === "better" || unrivalled) ? "ready" : "other";
}

export function byPriority(left: Group, right: Group): number {
    return (
        RANK_ORDER[left.rank] - RANK_ORDER[right.rank] ||
        scoredTime(right.summary.version) - scoredTime(left.summary.version)
    );
}

export function groupsOf(lines: Line[]): Group[] {
    const byModel = new Map<string, Line[]>();
    for (const line of lines) {
        byModel.set(line.model.key, [...(byModel.get(line.model.key) ?? []), line]);
    }
    return [...byModel.values()]
        .map((members) => {
            const ordered = [...members].sort(newestFirst);
            const summary = ordered.find((line) => scored(line.version)) ?? ordered[0];
            return { model: summary.model, summary, lines: ordered, rank: rankOf(summary) };
        })
        .sort(byPriority);
}

export function commonMetric(lines: Line[]): string | null {
    const counts = new Map<string, number>();
    for (const { version } of lines) {
        if (scored(version) && version.metric) {
            counts.set(version.metric, (counts.get(version.metric) ?? 0) + 1);
        }
    }
    const ranked = [...counts.entries()].sort(
        (left, right) => right[1] - left[1] || left[0].localeCompare(right[0]),
    );
    return ranked[0]?.[0] ?? null;
}

export function mixedMetrics(lines: Line[]): boolean {
    const metrics = new Set(
        lines.filter((line) => scored(line.version)).map((line) => line.version.metric ?? null),
    );
    return metrics.size > 1;
}
