import type { ColumnDef } from "@tanstack/react-table";
import { Button, DataGrid } from "obp-ui";
import { type ReactNode, useState } from "react";
import { count } from "~/lib/format";

export const LABELS_SHOWN = 20;
export const ENDS_SHOWN = 10;
export const ROWS_SHOWN = 10;
export const FOLDED_LABELS = ENDS_SHOWN * 2 + 1;

export type ListColumn<T> = {
    header: string;
    value: (row: T) => string | number;
    render?: (row: T) => ReactNode;
};

type Gap = { gap: number };

type Line<T> = T | Gap;

function isGap<T extends object>(row: Line<T>): row is Gap {
    return "gap" in row;
}

export function ShowAll({
    open,
    total,
    onToggle,
}: {
    open: boolean;
    total: number;
    onToggle: () => void;
}) {
    return (
        <Button
            variant="link"
            className="h-auto self-start px-0 py-0.5"
            aria-expanded={open}
            onClick={onToggle}
        >
            {open ? "Show fewer" : `Show all ${count(total)}`}
        </Button>
    );
}

export function LabelChips({ labels }: { labels: string[] }) {
    const [open, setOpen] = useState(false);
    const long = labels.length > LABELS_SHOWN;
    const shown = open || !long ? labels : labels.slice(0, LABELS_SHOWN);
    return (
        <div className="flex flex-col gap-1.5">
            <ul className="flex flex-wrap gap-1.5">
                {shown.map((label) => (
                    <li
                        key={label}
                        className="rounded-md border px-1.5 font-mono text-sm leading-6 break-all"
                    >
                        {label}
                    </li>
                ))}
            </ul>
            {long && <ShowAll open={open} total={labels.length} onToggle={() => setOpen(!open)} />}
        </div>
    );
}

function lineColumns<T extends object>(
    columns: ListColumn<T>[],
    gapText: (hidden: number) => string,
): ColumnDef<Line<T>, unknown>[] {
    return columns.map((column, index) => ({
        id: column.header,
        header: column.header,
        accessorFn: (row) => (isGap(row) ? "" : column.value(row)),
        cell: ({ row: { original } }) => {
            if (isGap(original)) {
                return index === 0 ? (
                    <span className="text-muted-foreground">{gapText(original.gap)}</span>
                ) : null;
            }
            return column.render ? column.render(original) : column.value(original);
        },
    }));
}

function endsOf<T>(rows: T[], open: boolean): Line<T>[] {
    if (open || rows.length <= FOLDED_LABELS) {
        return rows;
    }
    const hidden = rows.length - ENDS_SHOWN * 2;
    return [...rows.slice(0, ENDS_SHOWN), { gap: hidden }, ...rows.slice(-ENDS_SHOWN)];
}

export function EndsGrid<T extends object>({
    columns,
    rows,
    getRowId,
    noun,
}: {
    columns: ListColumn<T>[];
    rows: T[];
    getRowId: (row: T) => string;
    noun: string;
}) {
    const [open, setOpen] = useState(false);
    const lines = endsOf(rows, open);
    const folded = lines.length < rows.length;
    return (
        <div className="flex flex-col gap-1.5">
            <DataGrid
                columns={lineColumns(columns, (hidden) => `${count(hidden)} more ${noun}`)}
                rows={lines}
                getRowId={(row) => (isGap(row) ? "gap" : getRowId(row))}
                sortable={!folded}
            />
            {(folded || open) && (
                <ShowAll open={open} total={rows.length} onToggle={() => setOpen(!open)} />
            )}
        </div>
    );
}

export function useFolded<T>(rows: T[], from: "start" | "end" = "start") {
    const [open, setOpen] = useState(false);
    const long = rows.length > ROWS_SHOWN;
    const kept = from === "start" ? rows.slice(0, ROWS_SHOWN) : rows.slice(-ROWS_SHOWN);
    return {
        rows: open || !long ? rows : kept,
        toggle: long ? (
            <ShowAll open={open} total={rows.length} onToggle={() => setOpen(!open)} />
        ) : null,
    };
}
