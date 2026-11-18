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
    SegmentedTabs,
} from "obp-ui";
import { Fragment, type ReactNode, useState } from "react";
import { useJoinTokens } from "~/api/joinTokenQueries";
import { problemsOfMachine, useProblems } from "~/api/problemQueries";
import { useCan } from "~/lib/access";
import { count } from "~/lib/format";
import { splitList, useListSearch } from "~/lib/listSearch";
import { useScrollToHash } from "~/lib/scrollToHash";
import { MachineSheet } from "./MachineSheet";
import { ModelTable } from "./ModelView";
import { PoolTable, usePoolSizing } from "./PoolView";
import { type ShownGroup, modelGroups, shownGroups } from "./byModel";
import {
    type MachineFilters,
    type MachineRow,
    ROLES,
    STATUSES,
    acceleratorOf,
    machineRows,
    matches,
    statusOf,
} from "./machines";
import { type InfrastructureInfo, type PoolInfo, plural, useOpenRows } from "./parts";
import { type Sort, nextSort } from "./sorting";

const PATH = "/infrastructure/machines";
const KEYS = ["group", "status", "pool", "role", "accelerator", "q", "machine"] as const;
const MODEL_VIEW = "model";
const GROUPS = [
    { key: "pool", label: "Pool" },
    { key: MODEL_VIEW, label: "Model" },
];

function options(values: string[]): { value: string; label: string }[] {
    return [...new Set(values)].sort().map((value) => ({ value, label: value }));
}

function filterSections(
    rows: MachineRow[],
    filters: MachineFilters,
    update: (patch: Partial<Record<(typeof KEYS)[number], string>>) => void,
): FilterMenuSection[] {
    const counted = (
        items: { value: string; label: string }[],
        test: (row: MachineRow, value: string) => boolean,
    ) =>
        items.map((item) => ({
            ...item,
            count: rows.filter((row) => test(row, item.value)).length,
        }));
    return [
        {
            kind: "options",
            key: "status",
            title: "Status",
            options: counted(STATUSES, (row, value) => statusOf(row.node) === value),
            value: filters.status,
            onValueChange: (next) => update({ status: next.join(",") }),
        },
        {
            kind: "options",
            key: "pool",
            title: "Pool",
            options: counted(
                [...new Set(rows.map((row) => row.pool.name))].map((value) => ({
                    value,
                    label: value,
                })),
                (row, value) => row.pool.name === value,
            ),
            value: filters.pool,
            onValueChange: (next) => update({ pool: next.join(",") }),
        },
        {
            kind: "options",
            key: "role",
            title: "Role",
            options: counted(ROLES, (row, value) => row.node.roles.includes(value)).filter(
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
                options(rows.map((row) => acceleratorOf(row.node))),
                (row, value) => acceleratorOf(row.node) === value,
            ),
            value: filters.accelerator,
            onValueChange: (next) => update({ accelerator: next.join(",") }),
        },
    ];
}

function ViewMenu({ sizing }: { sizing: ColumnSizing }) {
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

function unlistedParts(rows: MachineRow[], groups: ShownGroup[]): string[] {
    const listed = new Set(
        groups.flatMap(({ places }) =>
            places.flatMap((place) => place.machines.map((machine) => machine.row.node.id)),
        ),
    );
    const unlisted = rows.filter((row) => !listed.has(row.node.id));
    const idle = unlisted.filter((row) => row.node.jobs.length === 0).length;
    const jobsOnly = unlisted.length - idle;
    return [
        idle > 0 ? plural(idle, "idle machine") : null,
        jobsOnly > 0 ? `${plural(jobsOnly, "machine")} running jobs only` : null,
    ].filter((part): part is string => part !== null);
}

export function MachinesTab({
    pools,
    main,
    info,
    loading,
}: {
    pools: PoolInfo[];
    main: Record<string, string>;
    info: InfrastructureInfo | undefined;
    loading: boolean;
}) {
    const { search, update } = useListSearch(PATH, KEYS);
    const byModel = search.group === MODEL_VIEW;
    const open = useOpenRows();
    const can = useCan();
    const tokens = useJoinTokens({ enabled: can.admin });
    const problems = useProblems({ scope: "infrastructure" }).data;
    const [sort, setSort] = useState<Sort | null>(null);
    useScrollToHash(!loading);
    const filters: MachineFilters = {
        status: splitList(search.status),
        pool: splitList(search.pool),
        role: splitList(search.role),
        accelerator: splitList(search.accelerator),
        q: search.q ?? "",
    };
    const all = machineRows(pools);
    const shown = all.filter((row) => matches(row, filters));
    const sizing = usePoolSizing(shown, problems, !byModel);
    const groups = byModel ? shownGroups(modelGroups(pools, all), filters) : [];
    const filtering =
        filters.status.length +
            filters.pool.length +
            filters.role.length +
            filters.accelerator.length >
            0 || filters.q !== "";
    const clear = () => update({ status: "", pool: "", role: "", accelerator: "", q: "" });
    const selected = all.find((row) => row.node.id === search.machine) ?? null;
    const openRow = (row: MachineRow) => update({ machine: row.node.id });
    const unlisted = byModel ? unlistedParts(shown, groups) : [];
    const empty: ReactNode = loading ? (
        "Loading machines…"
    ) : filtering ? (
        <span className="inline-flex items-center gap-2">
            {byModel ? "No models match these filters." : "No machines match these filters."}
            <Button variant="outline" onClick={clear}>
                Clear filters
            </Button>
        </span>
    ) : byModel ? (
        "No model is deployed."
    ) : (
        "No machines yet."
    );
    return (
        <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
                <SearchInput
                    aria-label={byModel ? "Search models and machines" : "Search machines"}
                    placeholder={byModel ? "Search by model or machine" : "Search by machine name"}
                    value={search.q ?? ""}
                    onValueChange={(q) => update({ q })}
                    className="w-full min-w-48 max-w-xs flex-1"
                />
                <FilterMenu
                    align="start"
                    sections={filterSections(all, filters, update)}
                    onClear={clear}
                    summary={`${count(shown.length)} of ${plural(all.length, "machine")}`}
                />
                {filtering && (
                    <Button variant="ghost" onClick={clear}>
                        Clear filters
                    </Button>
                )}
                <span className="ml-auto flex items-center gap-2">
                    <span className="text-muted-foreground">Group by</span>
                    <SegmentedTabs
                        size="sm"
                        tabs={GROUPS}
                        active={byModel ? MODEL_VIEW : "pool"}
                        onSelect={(key) => update({ group: key === MODEL_VIEW ? key : "" })}
                    />
                    {!byModel && <ViewMenu sizing={sizing} />}
                </span>
            </div>
            <div className="overflow-hidden rounded-md border bg-card">
                {byModel ? (
                    <ModelTable
                        groups={groups}
                        problems={problems}
                        open={open}
                        empty={empty}
                        onOpen={openRow}
                    />
                ) : (
                    <PoolTable
                        pools={pools}
                        shown={shown}
                        problems={problems}
                        admin={can.admin}
                        tokens={tokens.data}
                        sort={sort}
                        onSort={(key) => setSort((current) => nextSort(current, key))}
                        open={open}
                        onOpen={openRow}
                        sizing={sizing}
                        empty={empty}
                    />
                )}
                {unlisted.length > 0 && (
                    <p className="border-t px-3 py-2 text-sm text-muted-foreground">
                        {"Not listed, nothing deployed: "}
                        {unlisted.map((part, index) => (
                            <Fragment key={part}>
                                {index > 0 && " · "}
                                <button
                                    type="button"
                                    className="text-primary hover:underline"
                                    onClick={() => update({ group: "" })}
                                >
                                    {part}
                                </button>
                            </Fragment>
                        ))}
                    </p>
                )}
            </div>
            <MachineSheet
                row={selected}
                main={main}
                info={info}
                problems={selected ? problemsOfMachine(problems, selected.node.id) : []}
                onClose={() => update({ machine: "" })}
            />
        </div>
    );
}
