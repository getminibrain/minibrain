import type { SourceSummary } from "~/api/client";
import { plural, stem } from "./catalogue";

const INPUT_NAMES = /text|message|input|question|prompt|content|body|utterance|query/i;
const LABEL_NAMES = /label|intent|category|class|target|tag|topic|answer/i;

export function quoted(name: string): string {
    return `"${name.replaceAll('"', '""')}"`;
}

export function columnsSql(table: string, input: string, label: string): string {
    return `SELECT CAST(${quoted(input)} AS VARCHAR) AS input, CAST(${quoted(label)} AS VARCHAR) AS label FROM ${quoted(table)}`;
}

export function stackedSql(sources: SourceSummary[], input: string, label: string): string {
    return sources
        .map(
            (source) =>
                `SELECT ${quoted(input)} AS input, ${quoted(label)} AS label FROM ${quoted(source.table)}`,
        )
        .join("\nUNION ALL\n");
}

export function unionSql(sources: SourceSummary[]): string {
    return sources
        .map((source) => `SELECT * FROM ${quoted(source.table)}`)
        .join("\nUNION ALL BY NAME\n");
}

export function sharedColumns(sources: SourceSummary[]): string[] {
    const [first, ...rest] = sources;
    if (!first) {
        return [];
    }
    return first.columns
        .map((column) => column.name)
        .filter((name) =>
            rest.every((source) => source.columns.some((column) => column.name === name)),
        );
}

function guess(columns: string[], pattern: RegExp, skip?: string): string {
    return (
        columns.find((name) => pattern.test(name) && name !== skip) ??
        columns.find((name) => name !== skip) ??
        ""
    );
}

export function guessPair(columns: string[]): [string, string] {
    if (columns.length < 2) {
        return ["", ""];
    }
    const input = guess(columns, INPUT_NAMES);
    return [input, guess(columns, LABEL_NAMES, input)];
}

export function defaultName(sources: SourceSummary[]): string {
    const first = sources[0];
    if (!first) {
        return "";
    }
    const base = stem(first.name);
    return sources.length === 1 ? base : `${base} and ${plural(sources.length - 1, "more")}`;
}
