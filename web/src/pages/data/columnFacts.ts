import type { QueryResponse, SourceStats, SourceSummary } from "~/api/client";

export type ColumnFacts = {
    name: string;
    type: string;
    samples: string[];
    distinct: number | null;
};

export type Suggestion = { input: string; label: string };

type Profile = { name: string; text: boolean; averageLength: number; distinct: number };

const SAMPLES = 3;
const ANSWER_VALUES = { low: 2, high: 200 };
const ANSWER_CHARS = 40;
const ANSWER_NAMES =
    /^(label|category|intent|class|target|topic|tag|answer|response|output|expected)$/i;

function merged(lists: string[][]): string[] {
    return [...new Set(lists.flat())].slice(0, SAMPLES);
}

export function columnFacts(
    sources: SourceSummary[],
    stats: (SourceStats | undefined)[],
    names: string[],
): ColumnFacts[] {
    return names.map((name) => {
        const found = stats.map((item) => item?.columns.find((column) => column.name === name));
        const known = found.filter((column) => column !== undefined);
        const type =
            known[0]?.type ??
            sources[0]?.columns.find((column) => column.name === name)?.type ??
            "";
        return {
            name,
            type,
            samples: merged(known.map((column) => column.samples ?? [])),
            distinct: known.length > 0 ? Math.max(...known.map((column) => column.distinct)) : null,
        };
    });
}

function pair(profiles: Profile[]): Suggestion | null {
    const texts = profiles.filter((item) => item.text && item.averageLength > 0);
    const input = texts.reduce<Profile | null>(
        (best, item) => (best === null || item.averageLength > best.averageLength ? item : best),
        null,
    );
    if (!input) {
        return null;
    }
    const answers = texts
        .filter(
            (item) =>
                item !== input &&
                item.averageLength <= ANSWER_CHARS &&
                item.distinct >= ANSWER_VALUES.low &&
                item.distinct <= ANSWER_VALUES.high,
        )
        .sort(
            (left, right) =>
                Number(!ANSWER_NAMES.test(left.name)) - Number(!ANSWER_NAMES.test(right.name)) ||
                left.distinct - right.distinct,
        );
    return { input: input.name, label: answers[0]?.name ?? "" };
}

export function statsSuggestion(
    stats: SourceStats | undefined,
    names: string[],
): Suggestion | null {
    if (!stats?.suggested_input) {
        return null;
    }
    const usable = (name: string | null | undefined) => (name && names.includes(name) ? name : "");
    const input = usable(stats.suggested_input);
    return input ? { input, label: usable(stats.suggested_label) } : null;
}

export function rowsSuggestion(
    result: QueryResponse | undefined,
    names: string[],
): Suggestion | null {
    if (!result) {
        return null;
    }
    const profiles = result.columns.flatMap((name, index): Profile[] => {
        if (!names.includes(name)) {
            return [];
        }
        const values = result.rows
            .map((row) => row[index])
            .filter(
                (value): value is string => value !== null && value !== undefined && value !== "",
            );
        const total = values.reduce((sum, value) => sum + value.length, 0);
        return [
            {
                name,
                text: (result.types[index] ?? "").toUpperCase() === "VARCHAR",
                averageLength: values.length > 0 ? total / values.length : 0,
                distinct: new Set(values).size,
            },
        ];
    });
    return pair(profiles);
}
