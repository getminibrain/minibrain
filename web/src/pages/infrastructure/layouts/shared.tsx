import { IconDots, IconRotate } from "@tabler/icons-react";
import {
    Button,
    type ColumnSizing,
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuTrigger,
    FilterMenu,
    type FilterMenuSection,
    SearchInput,
} from "obp-ui";
import type { ReactNode } from "react";
import type { PoolToken } from "~/api/joinTokenQueries";
import type { Problem } from "~/api/problemQueries";
import { count } from "~/lib/format";
import { type ListSearch, splitList } from "~/lib/listSearch";
import {
    type MachineFilters,
    type MachineRow,
    ROLES,
    STATUSES,
    acceleratorOf,
    matches,
    statusOf,
} from "../machines";
import { type InfrastructureInfo, type OpenRows, type PoolInfo, plural } from "../parts";
import type { Sort, SortKey } from "../sorting";
import type { MachineKey } from "./switcher";

export const WIDTHS_KEY = "minibrain.machines.widths";

export type MachinesView = {
    pools: PoolInfo[];
    all: MachineRow[];
    problems: Problem[] | undefined;
    admin: boolean;
    tokens: PoolToken[] | undefined;
    search: ListSearch<MachineKey>;
    update: (patch: ListSearch<MachineKey>) => void;
    open: OpenRows;
    sort: Sort | null;
    onSort: (key: SortKey) => void;
    loading: boolean;
    selected: MachineRow | null;
    onOpen: (row: MachineRow) => void;
    main: Record<string, string>;
    info: InfrastructureInfo | undefined;
};

function options(values: string[]): { value: string; label: string }[] {
    return [...new Set(values)].sort().map((value) => ({ value, label: value }));
}

function counted(
    rows: MachineRow[],
    items: { value: string; label: string }[],
    test: (row: MachineRow, value: string) => boolean,
) {
    return items.map((item) => ({
        ...item,
        count: rows.filter((row) => test(row, item.value)).length,
    }));
}

export function filterSections(
    rows: MachineRow[],
    filters: MachineFilters,
    update: (patch: ListSearch<MachineKey>) => void,
): FilterMenuSection[] {
    return [
        {
            kind: "options",
            key: "status",
            title: "Status",
            options: counted(rows, STATUSES, (row, value) => statusOf(row.node) === value),
            value: filters.status,
            onValueChange: (next) => update({ status: next.join(",") }),
        },
        {
            kind: "options",
            key: "pool",
            title: "Pool",
            options: counted(
                rows,
                options(rows.map((row) => row.pool.name)),
                (row, value) => row.pool.name === value,
            ),
            value: filters.pool,
            onValueChange: (next) => update({ pool: next.join(",") }),
        },
        {
            kind: "options",
            key: "role",
            title: "Role",
            options: counted(rows, ROLES, (row, value) => row.node.roles.includes(value)).filter(
                (item) => item.count > 0 || filters.role.includes(item.value),
            ),
            value: filters.role,
            onValueChange: (next) => update({ role: next.join(",") }),
        },
        {
            kind: "options",
            key: "accelerator",
            title: "Accelerator",
            options: counted(
                rows,
                options(rows.map((row) => acceleratorOf(row.node))),
                (row, value) => acceleratorOf(row.node) === value,
            ),
            value: filters.accelerator,
            onValueChange: (next) => update({ accelerator: next.join(",") }),
        },
    ];
}

export type FilteredMachines = {
    filters: MachineFilters;
    shown: MachineRow[];
    filtering: boolean;
    clear: () => void;
    sections: FilterMenuSection[];
};

export function useMachineFilters(view: MachinesView): FilteredMachines {
    const { search, update, all } = view;
    const filters: MachineFilters = {
        status: splitList(search.status),
        pool: splitList(search.pool),
        role: splitList(search.role),
        accelerator: splitList(search.accelerator),
        q: search.q ?? "",
    };
    const filtering =
        filters.status.length +
            filters.pool.length +
            filters.role.length +
            filters.accelerator.length >
            0 || filters.q !== "";
    return {
        filters,
        shown: all.filter((row) => matches(row, filters)),
        filtering,
        clear: () => update({ status: "", pool: "", role: "", accelerator: "", use: "", q: "" }),
        sections: filterSections(all, filters, update),
    };
}

export function fitKeyOf(rows: MachineRow[], problems: Problem[] | undefined): string {
    return `${rows.map((row) => row.node.id).join(",")}|${problems?.length ?? 0}`;
}

export function ViewMenu({ sizing }: { sizing: ColumnSizing }) {
    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" aria-label="View options">
                    <IconDots />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel>View</DropdownMenuLabel>
                <DropdownMenuItem disabled={!sizing.customized} onSelect={sizing.reset}>
                    <IconRotate aria-hidden="true" />
                    Reset column widths
                </DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>
    );
}

export function MachineToolbar({
    view,
    filtered,
    placeholder = "Search by machine name",
    filters,
    end,
}: {
    view: MachinesView;
    filtered: FilteredMachines;
    placeholder?: string;
    filters?: ReactNode;
    end?: ReactNode;
}) {
    return (
        <div className="flex flex-wrap items-center gap-2">
            <SearchInput
                aria-label={placeholder}
                placeholder={placeholder}
                value={view.search.q ?? ""}
                onValueChange={(q) => view.update({ q })}
                className="w-full min-w-48 max-w-xs flex-1"
            />
            {filters ?? (
                <FilterMenu
                    align="start"
                    sections={filtered.sections}
                    onClear={filtered.clear}
                    summary={`${count(filtered.shown.length)} of ${plural(view.all.length, "machine")}`}
                />
            )}
            {filtered.filtering && (
                <Button variant="ghost" onClick={filtered.clear}>
                    Clear filters
                </Button>
            )}
            {end && <span className="ml-auto flex items-center gap-2">{end}</span>}
        </div>
    );
}

export function emptyText(view: MachinesView, filtered: FilteredMachines): ReactNode {
    if (view.loading) {
        return "Loading machines…";
    }
    if (filtered.filtering) {
        return (
            <span className="inline-flex items-center gap-2">
                No machines match these filters.
                <Button variant="outline" onClick={filtered.clear}>
                    Clear filters
                </Button>
            </span>
        );
    }
    return "No machines yet.";
}
