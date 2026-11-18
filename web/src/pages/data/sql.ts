import type { SourceSummary } from "~/api/client";
import { plural, stem } from "./catalogue";

const INPUT_NAMES = /text|message|input|question|prompt|content|body|utterance|query/i;
const LABEL_NAMES = /label|intent|category|class|target|tag|topic|answer/i;
const MAPPED = new Set(["input", "label"]);

export type Picks = { tables: string[]; input: string; label: string; skipEmpty: boolean };

export function quoted(name: string): string {
    return `"${name.replaceAll('"', '""')}"`;
}

export function fromSql(tables: string[]): string {
    if (tables.length === 1) {
        return quoted(tables[0] ?? "");
    }
    const union = tables
        .map((table) => `  SELECT * FROM ${quoted(table)}`)
        .join("\n  UNION ALL BY NAME\n");
    return `(\n${union}\n)`;
}

function text(column: string): string {
    return `CAST(${quoted(column)} AS VARCHAR)`;
}

export function columnsSql(picks: Picks, kept: string[] = []): string {
    const others = kept
        .filter((name) => !MAPPED.has(name) && name !== picks.input && name !== picks.label)
        .map(quoted);
    const listed = [`${text(picks.input)} AS input`, `${text(picks.label)} AS label`, ...others];
    const query = `SELECT ${listed.join(", ")}\nFROM ${fromSql(picks.tables)}`;
    if (!picks.skipEmpty) {
        return query;
    }
    return `${query}\nWHERE ${quoted(picks.label)} IS NOT NULL AND trim(${text(picks.label)}) <> ''`;
}

export function everythingSql(tables: string[]): string {
    return `SELECT *\nFROM ${fromSql(tables)}`;
}

export function starterSql(table: string, input: string, label: string): string {
    return `SELECT ${quoted(input)} AS input, ${quoted(label)} AS label FROM ${quoted(table)}`;
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

function escaped(text: string): string {
    return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function mentions(sql: string, name: string): boolean {
    return new RegExp(`(^|[^\\w"])"?${escaped(name)}"?($|[^\\w"])`, "i").test(sql);
}

export function defaultName(sources: SourceSummary[]): string {
    const first = sources[0];
    if (!first) {
        return "";
    }
    const base = stem(first.name);
    return sources.length === 1 ? base : `${base} and ${plural(sources.length - 1, "more")}`;
}
