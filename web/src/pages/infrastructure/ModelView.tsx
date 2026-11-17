import { IconServer } from "@tabler/icons-react";
import { Link, TableBody, TableCell, TableHead, TableHeader, TableRow, cn } from "obp-ui";
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
import type { MachineRow } from "./machines";
import { MachineName, type OpenRows, ProblemBadge, RowToggle, rowEvents } from "./parts";

const COLUMNS = 6;
const LINK = "text-primary hover:underline";
const SUB_ROW = "border-border-soft";

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
            className="cursor-pointer outline-none focus-visible:bg-secondary"
        >
            <TableCell className="px-2 py-2">
                <RowToggle
                    open={open}
                    label={`${open ? "Hide" : "Show"} machines serving ${model.name}`}
                    onToggle={toggle}
                />
            </TableCell>
            <TableCell className="py-2">
                <StatusText tone={state.tone} active={state.active}>
                    {state.label}
                </StatusText>
            </TableCell>
            <TableCell className="py-2">
                <span className="flex min-w-0 items-center gap-2">
                    <PublisherLogo name={model.name} modelKey={model.model} size="sm" />
                    <Link href={modelPageHref(model.model)} className={cn(LINK, "truncate")}>
                        {model.name}
                    </Link>
                    {base && (
                        <span className="shrink-0 text-sm text-muted-foreground">Base model</span>
                    )}
                </span>
            </TableCell>
            <TableCell className="py-2">
                {model.version === null ? (
                    <span className="text-muted-foreground">–</span>
                ) : (
                    <Link href={modelVersionHref(model.model, model.version)} className={LINK}>
                        {`v${model.version}`}
                    </Link>
                )}
            </TableCell>
            <TableCell className="py-2 tabular-nums">{count(replicasOf(group).length)}</TableCell>
            <TableCell className="py-2">
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
                SUB_ROW,
                "cursor-pointer outline-none focus-visible:bg-secondary",
                !row.node.online && "text-muted-foreground",
            )}
        >
            <TableCell className="py-1.5" />
            <TableCell className="py-1.5">
                <StatusText tone={state.tone} active={state.active}>
                    {state.label}
                </StatusText>
            </TableCell>
            <TableCell className="py-1.5 pl-6">
                <span className="flex min-w-0 items-center gap-2">
                    <IconServer
                        aria-hidden="true"
                        className="size-4 shrink-0 text-muted-foreground"
                    />
                    <MachineName node={row.node} busy />
                    <span className="shrink-0 text-sm text-muted-foreground">
                        {engineLabel(engine.engine)}
                    </span>
                    <ProblemBadge problems={problems} />
                </span>
            </TableCell>
            <TableCell className="py-1.5" />
            <TableCell className="py-1.5" />
            <TableCell className="py-1.5">
                <PoolLink name={row.pool.name} />
            </TableCell>
        </TableRow>
    );
}

function NoReplicaRow({ place }: { place: ModelPlace }) {
    return (
        <TableRow className={cn(SUB_ROW, "hover:bg-transparent")}>
            <TableCell className="py-1.5" />
            <TableCell className="py-1.5">
                <StatusText tone="warning">No replica</StatusText>
            </TableCell>
            <TableCell className="py-1.5 pl-6 text-muted-foreground">
                No machine in this pool runs it
            </TableCell>
            <TableCell className="py-1.5" />
            <TableCell className="py-1.5" />
            <TableCell className="py-1.5">
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

export function ModelColumns() {
    return (
        <>
            <colgroup>
                <col className="w-10" />
                <col className="w-44" />
                <col className="w-[32%]" />
                <col className="w-28" />
                <col className="w-24" />
                <col />
            </colgroup>
            <TableHeader>
                <TableRow className="hover:bg-transparent">
                    <TableHead>
                        <span className="sr-only">Expand</span>
                    </TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Model</TableHead>
                    <TableHead>Live version</TableHead>
                    <TableHead>Replicas</TableHead>
                    <TableHead>Pools</TableHead>
                </TableRow>
            </TableHeader>
        </>
    );
}

export function ModelRows({
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
                    <TableCell colSpan={COLUMNS} className="h-32 text-center text-muted-foreground">
                        {empty}
                    </TableCell>
                </TableRow>
            )}
        </TableBody>
    );
}
