import { Link, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, cn } from "obp-ui";
import { Fragment, type ReactNode } from "react";
import { type Problem, problemsOfMachine } from "~/api/problemQueries";
import { PoolLink } from "~/components/PoolLink";
import { PublisherLogo } from "~/components/PublisherLogo";
import { StatusText } from "~/components/models/StatusText";
import { count } from "~/lib/format";
import { modelPageHref, modelVersionHref } from "~/lib/modelLinks";
import { engineLabel, engineState } from "./activity";
import {
    type ModelGroup,
    type ModelMachine,
    type ModelPlace,
    type ShownGroup,
    modelState,
    replicasOf,
} from "./byModel";
import { Dash, MachineLabel } from "./cells";
import type { MachineRow } from "./machines";
import { type OpenRows, RowToggle, rowEvents } from "./parts";

const SPAN = 5;
const LINK = "text-primary hover:underline";
const LEAF = "h-14 border-border-soft";

function ModelLine({
    group,
    open,
    onToggle,
}: {
    group: ModelGroup;
    open: boolean;
    onToggle: (open: boolean) => void;
}) {
    const { model } = group;
    const state = modelState(group);
    const base = model.model === model.base_model;
    const toggle = () => onToggle(!open);
    return (
        <TableRow
            {...rowEvents(toggle, onToggle)}
            aria-label={`${model.name}, ${state.label.toLowerCase()}`}
            className="h-14 cursor-pointer bg-muted outline-none hover:bg-muted focus-visible:bg-secondary"
        >
            <TableCell className="py-1.5 pl-1.5">
                <span className="flex min-w-0 items-center gap-2">
                    <RowToggle
                        open={open}
                        label={`${open ? "Hide" : "Show"} machines serving ${model.name}`}
                        onToggle={toggle}
                    />
                    <PublisherLogo name={model.name} modelKey={model.model} size="sm" />
                    <Link
                        href={modelPageHref(model.model)}
                        className={cn(LINK, "truncate font-medium")}
                    >
                        {model.name}
                    </Link>
                    {base && (
                        <span className="shrink-0 text-sm text-muted-foreground">Base model</span>
                    )}
                </span>
            </TableCell>
            <TableCell className="py-1.5">
                <StatusText tone={state.tone} active={state.active}>
                    {state.label}
                </StatusText>
            </TableCell>
            <TableCell className="py-1.5">
                {model.version === null ? (
                    <Dash />
                ) : (
                    <Link
                        href={modelVersionHref(model.model, model.version)}
                        className={cn(LINK, "tabular-nums")}
                    >
                        {`v${model.version}`}
                    </Link>
                )}
            </TableCell>
            <TableCell className="py-1.5 text-right tabular-nums">
                {count(replicasOf(group).length)}
            </TableCell>
            <TableCell className="py-1.5">
                <span className="block truncate">
                    {group.places.map((place, index) => (
                        <Fragment key={place.pool.name}>
                            {index > 0 && ", "}
                            <PoolLink name={place.pool.name} />
                        </Fragment>
                    ))}
                </span>
            </TableCell>
        </TableRow>
    );
}

function MachineSubRow({
    machine,
    problems,
    onOpen,
}: {
    machine: ModelMachine;
    problems: Problem[];
    onOpen: (row: MachineRow) => void;
}) {
    const { row, engine } = machine;
    const state = engineState(engine.state);
    return (
        <TableRow
            {...rowEvents(() => onOpen(row))}
            aria-label={`${row.node.host}, ${state.label.toLowerCase()}`}
            className={cn(
                LEAF,
                "cursor-pointer outline-none focus-visible:bg-secondary",
                !row.node.online && "text-muted-foreground",
            )}
        >
            <TableCell className="py-1 pl-[3.75rem]">
                <MachineLabel row={row} problems={problems} />
            </TableCell>
            <TableCell className="py-1">
                <StatusText tone={state.tone} active={state.active}>
                    {state.label}
                </StatusText>
            </TableCell>
            <TableCell className="py-1 text-muted-foreground">
                {engineLabel(engine.engine)}
            </TableCell>
            <TableCell className="py-1" />
            <TableCell className="py-1">
                <PoolLink name={row.pool.name} />
            </TableCell>
        </TableRow>
    );
}

function NoReplicaRow({ place }: { place: ModelPlace }) {
    return (
        <TableRow className={cn(LEAF, "hover:bg-transparent")}>
            <TableCell className="py-1 pl-[3.75rem] text-muted-foreground">
                No machine in this pool runs it
            </TableCell>
            <TableCell className="py-1">
                <StatusText tone="warning">No replica</StatusText>
            </TableCell>
            <TableCell className="py-1" />
            <TableCell className="py-1" />
            <TableCell className="py-1">
                <PoolLink name={place.pool.name} />
            </TableCell>
        </TableRow>
    );
}

function PlaceRows({
    place,
    problems,
    onOpen,
}: {
    place: ModelPlace;
    problems: Problem[] | undefined;
    onOpen: (row: MachineRow) => void;
}) {
    if (place.engines.length === 0) {
        return <NoReplicaRow place={place} />;
    }
    return (
        <>
            {place.machines.map((machine) => (
                <MachineSubRow
                    key={machine.engine.id}
                    machine={machine}
                    problems={problemsOfMachine(problems, machine.row.node.id)}
                    onOpen={onOpen}
                />
            ))}
        </>
    );
}

export function ModelTable({
    groups,
    problems,
    open,
    empty,
    onOpen,
}: {
    groups: ShownGroup[];
    problems: Problem[] | undefined;
    open: OpenRows;
    empty: ReactNode;
    onOpen: (row: MachineRow) => void;
}) {
    return (
        <Table className="table-fixed [&_td]:overflow-hidden">
            <colgroup>
                <col />
                <col className="w-48" />
                <col className="w-32" />
                <col className="w-24" />
                <col className="w-[22%]" />
            </colgroup>
            <TableHeader>
                <TableRow className="hover:bg-transparent">
                    <TableHead>Model</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Live version</TableHead>
                    <TableHead className="text-right">Replicas</TableHead>
                    <TableHead>Pools</TableHead>
                </TableRow>
            </TableHeader>
            <TableBody>
                {groups.length > 0 ? (
                    groups.map(({ group, places }) => {
                        const key = `model:${group.model.model}`;
                        const expanded = open.isOpen(key, true);
                        return (
                            <Fragment key={key}>
                                <ModelLine
                                    group={group}
                                    open={expanded}
                                    onToggle={(next) => open.set(key, next)}
                                />
                                {expanded &&
                                    places.map((place) => (
                                        <PlaceRows
                                            key={place.pool.name}
                                            place={place}
                                            problems={problems}
                                            onOpen={onOpen}
                                        />
                                    ))}
                            </Fragment>
                        );
                    })
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
