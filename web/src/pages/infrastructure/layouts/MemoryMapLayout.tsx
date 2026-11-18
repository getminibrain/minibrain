import { IconStack2 } from "@tabler/icons-react";
import {
    type ColumnSize,
    type ColumnSizing,
    Table,
    TableBody,
    TableCell,
    TableHeader,
    TableRow,
    cn,
    useColumnSizing,
} from "obp-ui";
import { type CSSProperties, Fragment, type ReactNode, useState } from "react";
import { type Problem, problemsOfMachine } from "~/api/problemQueries";
import { BASIS_HINTS, type GaugeBasis } from "~/components/UsageGauge";
import { bytes } from "~/lib/time";
import { UseBadge } from "../PoolUse";
import { engineLabel, jobSubject, memoryView, versioned } from "../activity";
import { Dash, MachineLabel, SortHead, Tip } from "../cells";
import { gpuText, memoryText, poolMemory } from "../fleet";
import type { MachineRow } from "../machines";
import { OnlineCount, type PoolInfo, rowEvents } from "../parts";
import { sortRows } from "../sorting";
import {
    MachineToolbar,
    type MachinesView,
    ViewMenu,
    WIDTHS_KEY,
    emptyText,
    fitKeyOf,
    useMachineFilters,
} from "./shared";

const COLUMNS: ColumnSize[] = [
    { id: "host", width: 180, min: 140, max: 280 },
    { id: "gpu", width: 80, min: 64 },
    { id: "memory", width: 440, min: 440, flex: true },
    { id: "models", width: 200, min: 160, max: 320 },
];

const SPAN = COLUMNS.length;
const SERIES = 5;
const ROW = "h-10";
const CELL = "py-1";
const OTHER = "other";
const FADE = "transition-opacity duration-100 motion-reduce:transition-none";

type Occupant = {
    key: string;
    name: string;
    detail: string;
    members: string[];
    bytes: number;
    training: boolean;
};

type MemoryMap = {
    capacity: number;
    used: number;
    basis: GaugeBasis;
    parts: Occupant[];
};

type Hot = { key: string | null; set: (key: string | null) => void };

function engineOccupant(engine: MachineRow["engines"][number]): Occupant {
    const adapters = engine.serves.reduce((sum, served) => sum + (served.adapter_bytes ?? 0), 0);
    const names = engine.serves.map((served) => versioned(served.name, served.version));
    const single = engine.serves.length === 1 ? engine.serves[0] : null;
    return {
        key: single ? single.model : `base:${engine.base_model}`,
        name: single ? versioned(single.name, single.version) : engine.base_model,
        detail:
            names.length > 1
                ? `${engine.base_model} serving ${names.join(", ")} · ${engineLabel(engine.engine)}`
                : `${engine.base_model} · ${engineLabel(engine.engine)}`,
        members: [`base:${engine.base_model}`, ...engine.serves.map((served) => served.model)],
        bytes: (engine.weights_bytes ?? 0) + adapters,
        training: false,
    };
}

function occupantsOf(row: MachineRow): Occupant[] {
    if (!row.node.online) {
        return [];
    }
    const found = new Map<string, Occupant>();
    const add = (item: Occupant) => {
        const id = `${item.training ? "t" : "s"}:${item.key}`;
        const known = found.get(id);
        if (known) {
            known.bytes += item.bytes;
        } else {
            found.set(id, { ...item });
        }
    };
    for (const engine of row.engines) {
        if (engine.state !== "failed" && engine.state !== "fetch_failed") {
            add(engineOccupant(engine));
        }
    }
    for (const job of row.node.jobs) {
        if (job.memory_bytes) {
            const key = job.model ?? `job:${job.id}`;
            add({
                key,
                name: jobSubject(job),
                detail: `Job ${job.id} · ${Math.round(job.progress * 100)}% done`,
                members: [key],
                bytes: job.memory_bytes,
                training: true,
            });
        }
    }
    return [...found.values()].filter((item) => item.bytes > 0);
}

function mapOf(row: MachineRow): MemoryMap | null {
    const view = memoryView(row.node, row.engines);
    if (!view) {
        return null;
    }
    const parts = occupantsOf(row);
    const known = parts.reduce((sum, part) => sum + part.bytes, 0);
    const other = view.basis === "measured" ? Math.max(0, view.used - known) : 0;
    const rest: Occupant = {
        key: OTHER,
        name: "Other",
        detail: "Measured on the machine, not from a model or job minibrain knows",
        members: [OTHER],
        bytes: other,
        training: false,
    };
    return {
        capacity: Math.max(view.capacity, known + other),
        used: Math.max(view.used, known),
        basis: view.basis,
        parts: other > 0 ? [...parts, rest] : parts,
    };
}

function seriesOf(key: string, keys: string[]): string {
    if (key === OTHER) {
        return "var(--faint)";
    }
    const index = Math.max(0, keys.indexOf(key)) % (SERIES * 2);
    const base = `var(--chart-series-${(index % SERIES) + 1})`;
    return index < SERIES ? base : `color-mix(in oklab, ${base} 60%, var(--foreground))`;
}

function swatchStyle(color: string, training: boolean): CSSProperties {
    return training
        ? {
              background: `color-mix(in oklab, ${color} 35%, var(--card))`,
              outline: `1px solid ${color}`,
              outlineOffset: "-1px",
          }
        : { background: color };
}

function Swatch({ color, training }: { color: string; training: boolean }) {
    return (
        <span
            aria-hidden="true"
            className="size-3 shrink-0 rounded-sm"
            style={swatchStyle(color, training)}
        />
    );
}

function dimmed(hot: Hot, members: string[]): string | false {
    return hot.key !== null && !members.includes(hot.key) && "opacity-25";
}

function partLabel(part: Occupant): string {
    return part.training ? `Training ${part.name}` : part.name;
}

function MapBar({
    host,
    map,
    keys,
    hot,
}: {
    host: string;
    map: MemoryMap;
    keys: string[];
    hot: Hot;
}) {
    const free = Math.max(0, map.capacity - map.used);
    return (
        <span
            role="img"
            aria-label={`${host} GPU memory: ${map.parts.map((part) => `${partLabel(part)} ${bytes(part.bytes)}`).join(", ")}, ${bytes(free)} free`}
            className="flex h-4 min-w-0 flex-1 overflow-hidden rounded-sm bg-secondary"
        >
            {map.parts.map((part) => (
                <Tip
                    key={`${part.training}-${part.key}`}
                    tip={
                        <span className="flex flex-col gap-0.5 tabular-nums">
                            <span>{`${partLabel(part)} · ${bytes(part.bytes)}`}</span>
                            <span className="text-muted-foreground">{part.detail}</span>
                        </span>
                    }
                >
                    <span
                        onMouseEnter={() => hot.set(part.key)}
                        onMouseLeave={() => hot.set(null)}
                        className={cn(
                            "h-full min-w-0.5 border-r border-card",
                            FADE,
                            dimmed(hot, part.members),
                        )}
                        style={{
                            width: `${(part.bytes / map.capacity) * 100}%`,
                            ...swatchStyle(seriesOf(part.key, keys), part.training),
                        }}
                    />
                </Tip>
            ))}
        </span>
    );
}

function MemoryCell({
    host,
    map,
    keys,
    hot,
}: {
    host: string;
    map: MemoryMap;
    keys: string[];
    hot: Hot;
}) {
    return (
        <span className="flex min-w-0 items-center gap-3">
            <MapBar host={host} map={map} keys={keys} hot={hot} />
            <Tip
                tip={
                    <span className="flex flex-col gap-1">
                        <span className="tabular-nums">{`${bytes(Math.max(0, map.capacity - map.used))} free`}</span>
                        <span className="text-muted-foreground">{BASIS_HINTS[map.basis]}</span>
                    </span>
                }
            >
                <span className="w-36 shrink-0 cursor-default text-right tabular-nums">
                    {memoryText(map.used, map.capacity)}
                    {map.basis === "estimated" && (
                        <span className="text-sm text-muted-foreground"> est.</span>
                    )}
                </span>
            </Tip>
        </span>
    );
}

function PartChip({ part, keys, hot }: { part: Occupant; keys: string[]; hot: Hot }) {
    return (
        <Tip tip={`${partLabel(part)} · ${bytes(part.bytes)} · ${part.detail}`}>
            <span
                onMouseEnter={() => hot.set(part.key)}
                onMouseLeave={() => hot.set(null)}
                className={cn(
                    "inline-flex h-6 min-w-0 shrink cursor-default items-center gap-1.5 rounded-md border px-1.5 text-sm",
                    FADE,
                    dimmed(hot, part.members),
                )}
            >
                <Swatch color={seriesOf(part.key, keys)} training={part.training} />
                <span className="min-w-0 truncate">{partLabel(part)}</span>
            </span>
        </Tip>
    );
}

type LegendItem = { key: string; name: string; bytes: number; serving: boolean };

function legendOf(rows: MachineRow[]): LegendItem[] {
    const items = new Map<string, LegendItem>();
    for (const row of rows) {
        for (const part of mapOf(row)?.parts ?? []) {
            const known = items.get(part.key);
            if (known) {
                known.bytes += part.bytes;
                known.serving ||= !part.training;
            } else {
                items.set(part.key, {
                    key: part.key,
                    name: part.name,
                    bytes: part.bytes,
                    serving: !part.training,
                });
            }
        }
    }
    return [...items.values()].sort((left, right) => {
        if (left.key === OTHER || right.key === OTHER) {
            return left.key === OTHER ? 1 : -1;
        }
        return left.name.localeCompare(right.name);
    });
}

function Legend({
    items,
    keys,
    hot,
    pinned,
    onPin,
}: {
    items: LegendItem[];
    keys: string[];
    hot: Hot;
    pinned: string | null;
    onPin: (key: string | null) => void;
}) {
    if (items.length === 0) {
        return null;
    }
    return (
        <div className="flex items-start gap-3 border-b px-3 py-2">
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
                {items.map((item) => (
                    <button
                        key={item.key}
                        type="button"
                        aria-pressed={pinned === item.key}
                        onMouseEnter={() => hot.set(item.key)}
                        onMouseLeave={() => hot.set(null)}
                        onFocus={() => hot.set(item.key)}
                        onBlur={() => hot.set(null)}
                        onClick={() => onPin(pinned === item.key ? null : item.key)}
                        className={cn(
                            "inline-flex h-7 items-center gap-1.5 rounded-md border border-transparent px-1.5 text-sm outline-none hover:bg-secondary focus-visible:ring-2 focus-visible:ring-ring aria-pressed:border-border aria-pressed:bg-accent",
                            FADE,
                            dimmed(hot, [item.key]),
                        )}
                    >
                        <Swatch color={seriesOf(item.key, keys)} training={!item.serving} />
                        <span>{item.name}</span>
                        <span className="text-muted-foreground tabular-nums">
                            {bytes(item.bytes)}
                        </span>
                    </button>
                ))}
            </div>
            <span className="flex h-7 shrink-0 items-center gap-3 text-sm text-muted-foreground">
                <span className="flex items-center gap-1.5">
                    <Swatch color="var(--muted-foreground)" training={false} />
                    Serving
                </span>
                <span className="flex items-center gap-1.5">
                    <Swatch color="var(--muted-foreground)" training />
                    Training
                </span>
                <span className="flex items-center gap-1.5">
                    <span aria-hidden="true" className="size-3 rounded-sm border bg-secondary" />
                    Free
                </span>
            </span>
        </div>
    );
}

function MachineLine({
    row,
    problems,
    keys,
    hot,
    onOpen,
}: {
    row: MachineRow;
    problems: Problem[];
    keys: string[];
    hot: Hot;
    onOpen: (row: MachineRow) => void;
}) {
    const map = mapOf(row);
    const parts = map?.parts.filter((part) => part.key !== OTHER) ?? [];
    return (
        <TableRow
            {...rowEvents(() => onOpen(row))}
            aria-label={row.node.host}
            className={cn(
                ROW,
                "cursor-pointer outline-none focus-visible:bg-secondary",
                !row.node.online && "text-muted-foreground",
            )}
        >
            <TableCell data-column="host" className={CELL}>
                <MachineLabel row={row} problems={problems} />
            </TableCell>
            <TableCell data-column="gpu" className={CELL}>
                <span className="block truncate" title={gpuText(row.node)}>
                    {gpuText(row.node, true)}
                </span>
            </TableCell>
            <TableCell className={CELL}>
                {map ? (
                    <MemoryCell host={row.node.host} map={map} keys={keys} hot={hot} />
                ) : (
                    <Dash />
                )}
            </TableCell>
            <TableCell data-column="models" className={CELL}>
                {parts.length > 0 ? (
                    <span className="flex min-w-0 items-center gap-1">
                        {parts.map((part) => (
                            <PartChip
                                key={`${part.training}-${part.key}`}
                                part={part}
                                keys={keys}
                                hot={hot}
                            />
                        ))}
                    </span>
                ) : (
                    <Dash />
                )}
            </TableCell>
        </TableRow>
    );
}

function PoolHeading({ pool, rows }: { pool: PoolInfo; rows: MachineRow[] }) {
    const memory = poolMemory(rows);
    return (
        <TableRow
            id={`pool-${pool.name}`}
            className="h-8 scroll-mt-24 bg-muted transition-colors duration-150 hover:bg-muted data-flash:bg-highlight motion-reduce:transition-none"
        >
            <TableCell colSpan={SPAN} className="py-1">
                <span className="flex min-w-0 items-center gap-2">
                    <IconStack2
                        aria-hidden="true"
                        className="size-4 shrink-0 text-muted-foreground"
                    />
                    <span className="font-medium">{pool.name}</span>
                    <UseBadge workloads={pool.workloads} />
                    <span className="text-sm">
                        <OnlineCount nodes={pool.nodes} />
                    </span>
                    {memory && (
                        <span className="text-sm text-muted-foreground tabular-nums">
                            {`· ${memoryText(memory.used, memory.capacity)} in use`}
                        </span>
                    )}
                </span>
            </TableCell>
        </TableRow>
    );
}

function MapTable({
    view,
    rows,
    keys,
    hot,
    sizing,
    empty,
}: {
    view: MachinesView;
    rows: MachineRow[];
    keys: string[];
    hot: Hot;
    sizing: ColumnSizing;
    empty: ReactNode;
}) {
    const sorted = sortRows(rows, view.sort, view.problems);
    const body = view.pools.flatMap((pool) => {
        const inPool = sorted.filter((row) => row.pool.name === pool.name);
        return inPool.length === 0
            ? []
            : [
                  <Fragment key={pool.name}>
                      <PoolHeading pool={pool} rows={inPool} />
                      {inPool.map((row) => (
                          <MachineLine
                              key={row.node.id}
                              row={row}
                              problems={problemsOfMachine(view.problems, row.node.id)}
                              keys={keys}
                              hot={hot}
                              onOpen={view.onOpen}
                          />
                      ))}
                  </Fragment>,
              ];
    });
    const head = { sort: view.sort, onSort: view.onSort, sizing };
    return (
        <Table ref={sizing.tableRef} style={sizing.tableStyle} className="[&_td]:overflow-hidden">
            <colgroup>
                {COLUMNS.map((column) => (
                    <col key={column.id} style={sizing.colStyle(column.id)} />
                ))}
            </colgroup>
            <TableHeader>
                <TableRow className="hover:bg-transparent">
                    <SortHead label="Machine" sortKey="host" {...head} />
                    <SortHead label="GPU" sortKey="gpu" {...head} />
                    <SortHead label="GPU memory" sortKey="memory" {...head} />
                    <SortHead label="Using it" sortKey="models" {...head} />
                </TableRow>
            </TableHeader>
            <TableBody>
                {body.length > 0 ? (
                    body
                ) : (
                    <TableRow className="hover:bg-transparent">
                        <TableCell
                            colSpan={SPAN}
                            className="h-32 text-center text-muted-foreground"
                        >
                            {empty}
                        </TableCell>
                    </TableRow>
                )}
            </TableBody>
        </Table>
    );
}

export function MemoryMapLayout({ view }: { view: MachinesView }) {
    const filtered = useMachineFilters(view);
    const [hovered, setHovered] = useState<string | null>(null);
    const [pinned, setPinned] = useState<string | null>(null);
    const hot: Hot = { key: hovered ?? pinned, set: setHovered };
    const sizing = useColumnSizing({
        columns: COLUMNS,
        storageKey: WIDTHS_KEY,
        fitKey: fitKeyOf(filtered.shown, view.problems),
    });
    const legend = legendOf(filtered.shown);
    const keys = legend.filter((item) => item.key !== OTHER).map((item) => item.key);
    return (
        <>
            <MachineToolbar view={view} filtered={filtered} end={<ViewMenu sizing={sizing} />} />
            <div className="overflow-hidden rounded-md border bg-card">
                <Legend items={legend} keys={keys} hot={hot} pinned={pinned} onPin={setPinned} />
                <MapTable
                    view={view}
                    rows={filtered.shown}
                    keys={keys}
                    hot={hot}
                    sizing={sizing}
                    empty={emptyText(view, filtered)}
                />
            </div>
        </>
    );
}
