import type { ColumnDef, SortingFn } from "@tanstack/react-table";
import type { ReactNode } from "react";
import type { QueryResponse } from "~/api/client";
import { typeWord } from "./columnTypes";

type Cell = string | null;
type Row = Cell[];
type Kind = "number" | "time" | "boolean" | "text";

const NUMBER = /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i;
const INFINITE = /^[+-]?inf(inity)?$/i;
const DATE_TIME = /^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}(:\d{2}(\.\d+)?)?)?(Z|[+-]\d{2}(:?\d{2})?)?$/i;
const BOOLEAN = new Set(["true", "false"]);
const KIND_OF_WORD: Record<string, Kind> = {
    "Whole number": "number",
    Number: "number",
    Date: "time",
    "Date and time": "time",
    "Yes/no": "boolean",
};

function kindOfType(type: string): Kind {
    return KIND_OF_WORD[typeWord(type)] ?? "text";
}

function kindOfValues(values: Cell[]): Kind {
    const present = values.filter((value): value is string => value !== null && value !== "");
    if (present.length === 0) {
        return "text";
    }
    if (present.every((value) => NUMBER.test(value.trim()))) {
        return "number";
    }
    if (present.every((value) => BOOLEAN.has(value.toLowerCase()))) {
        return "boolean";
    }
    if (present.every((value) => DATE_TIME.test(value) && !Number.isNaN(timeOf(value)))) {
        return "time";
    }
    return "text";
}

function numberOf(text: string): number | undefined {
    const trimmed = text.trim();
    if (INFINITE.test(trimmed)) {
        return trimmed.startsWith("-") ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY;
    }
    const value = Number(trimmed);
    return trimmed === "" || Number.isNaN(value) ? undefined : value;
}

function timeOf(text: string): number {
    const iso = text.replace(" ", "T").replace(/(T[\d:.]+[+-]\d{2})$/, "$1:00");
    return Date.parse(iso);
}

function sortValue(kind: Kind, text: Cell): number | string | undefined {
    if (text === null || text === "") {
        return undefined;
    }
    if (kind === "number") {
        return numberOf(text);
    }
    if (kind === "time") {
        const time = timeOf(text);
        return Number.isNaN(time) ? undefined : time;
    }
    if (kind === "boolean") {
        return text.toLowerCase() === "true" ? 1 : 0;
    }
    return text;
}

function columnKind(result: QueryResponse, index: number): Kind {
    const type: string | undefined = result.types[index];
    return type ? kindOfType(type) : kindOfValues(result.rows.map((row) => row[index] ?? null));
}

function ResultCell({ value, kind }: { value: Cell; kind: Kind }) {
    if (value === null || value === "") {
        return <span className="text-muted-foreground">–</span>;
    }
    if (kind === "number") {
        return <span className="tabular-nums">{value}</span>;
    }
    return <span className="line-clamp-2 max-w-xl whitespace-normal">{value}</span>;
}

export function resultColumns(
    result: QueryResponse,
    heading?: (name: string) => ReactNode | null,
): ColumnDef<Row, unknown>[] {
    return result.columns.map((name, index) => {
        const kind = columnKind(result, index);
        const custom = heading?.(name) ?? null;
        return {
            id: `${index}:${name}`,
            header: () => custom ?? <span className="font-mono">{name}</span>,
            enableSorting: custom === null,
            accessorFn: (row) => sortValue(kind, row[index] ?? null),
            sortingFn: kind === "text" ? "text" : "basic",
            sortUndefined: "last",
            cell: (info) => <ResultCell value={info.row.original[index] ?? null} kind={kind} />,
        };
    });
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

function compareText(left: unknown, right: unknown): number {
    const a = left === null || left === undefined ? "" : String(left);
    const b = right === null || right === undefined ? "" : String(right);
    const x = numberOf(a);
    const y = numberOf(b);
    if (x !== undefined && y !== undefined) {
        return x === y ? 0 : x < y ? -1 : 1;
    }
    return collator.compare(a, b);
}

export function naturalSort<T>(): SortingFn<T> {
    return (left, right, columnId) =>
        compareText(left.getValue(columnId), right.getValue(columnId));
}
