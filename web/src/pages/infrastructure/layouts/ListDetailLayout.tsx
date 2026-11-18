import { StatusDot, cn } from "obp-ui";
import { type KeyboardEvent, type ReactNode, useEffect } from "react";
import { problemsOfMachine } from "~/api/problemQueries";
import { PoolLink } from "~/components/PoolLink";
import { count } from "~/lib/format";
import { bytes } from "~/lib/time";
import { Block, MachineBlocks, MachineSummary } from "../MachineSheet";
import { MeterBar } from "../cells";
import { memoryOf, percentText, problemTone, shareOf, shortGpu, statusTone } from "../fleet";
import type { MachineRow } from "../machines";
import { type PoolInfo, plural } from "../parts";
import { sortRows } from "../sorting";
import { MachineToolbar, type MachinesView, emptyText, useMachineFilters } from "./shared";

const MOVES: Record<string, (index: number, last: number) => number> = {
    ArrowDown: (index, last) => Math.min(last, index + 1),
    ArrowUp: (index) => Math.max(0, index - 1),
    Home: () => 0,
    End: (_, last) => last,
};

function optionId(row: MachineRow): string {
    return `machine-option-${row.node.id}`;
}

function MachineOption({
    row,
    selected,
    alert,
    onSelect,
    onKeyDown,
}: {
    row: MachineRow;
    selected: boolean;
    alert: "destructive" | "warning" | null;
    onSelect: () => void;
    onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void;
}) {
    const status = statusTone(row);
    const memory = memoryOf(row);
    return (
        <button
            type="button"
            id={optionId(row)}
            aria-current={selected || undefined}
            tabIndex={selected ? 0 : -1}
            onClick={onSelect}
            onKeyDown={onKeyDown}
            className={cn(
                "flex h-10 w-full cursor-pointer items-center gap-2 border-b border-border-soft px-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
                selected ? "bg-accent text-accent-foreground" : "hover:bg-secondary",
                !row.node.online && !selected && "text-muted-foreground",
            )}
        >
            <StatusDot
                tone={alert ?? status.tone}
                active={status.active}
                label={alert ? "Has problems" : status.label}
            />
            <span className="min-w-0 flex-1 truncate font-mono">{row.node.host}</span>
            {memory ? (
                <span className="flex shrink-0 items-center gap-2">
                    <MeterBar
                        used={memory.used}
                        capacity={memory.capacity}
                        label={`${row.node.host} memory`}
                        className="w-12"
                    />
                    <span className="w-9 text-right text-sm tabular-nums">
                        {percentText(shareOf(memory.used, memory.capacity))}
                    </span>
                </span>
            ) : (
                <span className="shrink-0 text-sm text-muted-foreground">
                    {row.node.online ? "–" : "Offline"}
                </span>
            )}
        </button>
    );
}

function PoolGroup({
    pool,
    rows,
    children,
}: {
    pool: PoolInfo;
    rows: MachineRow[];
    children: ReactNode;
}) {
    const online = rows.filter((row) => row.node.online).length;
    return (
        <li id={`pool-${pool.name}`} className="scroll-mt-24">
            <div className="flex h-8 items-center justify-between gap-2 border-b bg-muted px-3">
                <PoolLink name={pool.name} className="font-medium" />
                <span className="text-sm text-muted-foreground tabular-nums">
                    {`${count(online)} of ${count(rows.length)} online`}
                </span>
            </div>
            <ul aria-label={`Machines in pool ${pool.name}`}>{children}</ul>
        </li>
    );
}

function GpuMemoryBlock({ row }: { row: MachineRow }) {
    const { node } = row;
    if (node.gpus.length === 0) {
        return null;
    }
    const samples = node.online ? (node.metrics?.gpus ?? []) : [];
    return (
        <Block title="Memory per GPU">
            <ul className="flex flex-col gap-2">
                {node.gpus.map((gpu, index) => {
                    const sample = samples.find((item) => item.index === index);
                    const used = sample?.memory_used_bytes;
                    const total = sample?.memory_total_bytes ?? gpu.memory_bytes;
                    return (
                        <li
                            key={`${gpu.name}-${String(index)}`}
                            className="grid grid-cols-[4rem_10rem_minmax(0,1fr)_12rem] items-center gap-3"
                        >
                            <span className="text-muted-foreground tabular-nums">{`GPU ${index}`}</span>
                            <span className="truncate">{shortGpu(gpu.name)}</span>
                            {used === null || used === undefined ? (
                                <span className="text-sm text-muted-foreground">Not reported</span>
                            ) : (
                                <MeterBar
                                    used={used}
                                    capacity={total}
                                    label={`GPU ${index} memory`}
                                />
                            )}
                            <span className="text-right text-sm tabular-nums">
                                {used === null || used === undefined
                                    ? bytes(total)
                                    : `${bytes(used)} of ${bytes(total)}${
                                          sample?.utilization !== null &&
                                          sample?.utilization !== undefined
                                              ? ` · ${Math.round(sample.utilization)}% load`
                                              : ""
                                      }`}
                            </span>
                        </li>
                    );
                })}
            </ul>
        </Block>
    );
}

function DetailPanel({ view, row }: { view: MachinesView; row: MachineRow }) {
    return (
        <section
            aria-label={row.node.host}
            className="flex min-w-0 max-w-4xl flex-col gap-5 p-panel"
        >
            <header className="flex flex-col gap-1">
                <h2 className="font-mono text-lg font-medium">{row.node.host}</h2>
                <p className="flex flex-wrap items-baseline gap-x-2 text-muted-foreground">
                    <MachineSummary row={row} />
                    <span>·</span>
                    <PoolLink name={row.pool.name} />
                </p>
            </header>
            <MachineBlocks
                row={row}
                main={view.main}
                info={view.info}
                problems={problemsOfMachine(view.problems, row.node.id)}
                after={<GpuMemoryBlock row={row} />}
            />
        </section>
    );
}

export function ListDetailLayout({ view }: { view: MachinesView }) {
    const filtered = useMachineFilters(view);
    const groups = view.pools
        .map((pool) => ({
            pool,
            rows: sortRows(
                filtered.shown.filter((row) => row.pool.name === pool.name),
                view.sort,
                view.problems,
            ),
        }))
        .filter((group) => group.rows.length > 0);
    const ordered = groups.flatMap((group) => group.rows);
    const selected = view.selected ?? null;
    const first = ordered[0];
    const { update } = view;
    useEffect(() => {
        if (!selected && first) {
            update({ machine: first.node.id });
        }
    }, [selected, first, update]);
    useEffect(() => {
        if (selected) {
            document.getElementById(optionId(selected))?.scrollIntoView({ block: "nearest" });
        }
    }, [selected]);
    const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, row: MachineRow) => {
        const move = MOVES[event.key];
        if (!move) {
            return;
        }
        event.preventDefault();
        const index = ordered.findIndex((item) => item.node.id === row.node.id);
        const next = ordered[move(index, ordered.length - 1)];
        if (next) {
            update({ machine: next.node.id });
            document.getElementById(optionId(next))?.focus();
        }
    };
    return (
        <>
            <MachineToolbar view={view} filtered={filtered} />
            <div className="grid grid-cols-[20rem_minmax(0,1fr)] overflow-hidden rounded-md border bg-card">
                <div className="sticky top-0 flex max-h-[calc(100vh-4rem)] flex-col self-start overflow-y-auto">
                    <div className="flex h-8 items-center border-b bg-secondary px-3 text-muted-foreground">
                        {plural(ordered.length, "machine")}
                    </div>
                    {ordered.length === 0 ? (
                        <p className="p-panel text-center text-muted-foreground">
                            {emptyText(view, filtered)}
                        </p>
                    ) : (
                        <ul aria-label="Machines by pool">
                            {groups.map((group) => (
                                <PoolGroup
                                    key={group.pool.name}
                                    pool={group.pool}
                                    rows={group.rows}
                                >
                                    {group.rows.map((row) => {
                                        const problems = problemsOfMachine(
                                            view.problems,
                                            row.node.id,
                                        ).filter((problem) => problem.kind !== "machine_offline");
                                        return (
                                            <li key={row.node.id}>
                                                <MachineOption
                                                    row={row}
                                                    selected={selected?.node.id === row.node.id}
                                                    alert={
                                                        problems.length > 0
                                                            ? problemTone(problems)
                                                            : null
                                                    }
                                                    onSelect={() =>
                                                        update({ machine: row.node.id })
                                                    }
                                                    onKeyDown={(event) => onKeyDown(event, row)}
                                                />
                                            </li>
                                        );
                                    })}
                                </PoolGroup>
                            ))}
                        </ul>
                    )}
                </div>
                <div className="min-h-[32rem] border-l">
                    {selected ? (
                        <DetailPanel view={view} row={selected} />
                    ) : (
                        <p className="p-panel text-muted-foreground">Pick a machine on the left.</p>
                    )}
                </div>
            </div>
        </>
    );
}
