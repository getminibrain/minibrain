import { Button, ConfirmDialog } from "obp-ui";
import { useMachineAction } from "~/api/machineQueries";
import { BlockedButton } from "~/components/BlockedButton";
import { RemoveMachineDialog } from "~/components/RemoveMachine";
import { ErrorLine } from "~/components/Section";
import { useCan } from "~/lib/access";
import { type MachineRow, busyOf } from "./machines";
import { plural } from "./parts";

function workLeft(row: MachineRow): string {
    return [
        row.node.jobs.length > 0 ? plural(row.node.jobs.length, "job") : null,
        row.engines.length > 0 ? plural(row.engines.length, "engine") : null,
    ]
        .filter(Boolean)
        .join(" and ");
}

function drainText(row: MachineRow): string {
    return `Jobs running on ${row.node.host} finish; no new job starts there. Each engine keeps serving until another machine in pool ${row.pool.name} has its model ready, then stops. A model no other machine can take keeps serving here. Undrain to take work again.`;
}

function removeBlock(row: MachineRow): string | null {
    if (busyOf(row.node, row.engines)) {
        return `Still runs ${workLeft(row)}. Wait until they finish, then remove it.`;
    }
    if (row.node.online && row.node.state !== "draining") {
        return "Online and taking work. Drain it first.";
    }
    return null;
}

function stateText(row: MachineRow): string {
    if (row.node.state !== "draining") {
        return "Takes new jobs and engines.";
    }
    return busyOf(row.node, row.engines)
        ? `Draining: ${workLeft(row)} left. It takes no new work.`
        : "Drained: nothing runs here and it takes no new work. Safe to remove.";
}

export function MachineActions({ row }: { row: MachineRow }) {
    const can = useCan();
    const action = useMachineAction(row.pool.name, row.node.host);
    if (row.node.roles.includes("main")) {
        return (
            <p className="text-muted-foreground">
                Main runs minibrain itself; it stays in its pool.
            </p>
        );
    }
    if (!can.admin) {
        return <p className="text-muted-foreground">An admin can drain or remove this machine.</p>;
    }
    const draining = row.node.state === "draining";
    const blocked = removeBlock(row);
    const run = (next: "drain" | "undrain" | "remove") =>
        action.mutateAsync(next).catch(() => undefined);
    return (
        <div className="flex flex-col gap-3">
            <p className="text-muted-foreground">{stateText(row)}</p>
            <div className="flex flex-wrap gap-2">
                {draining ? (
                    <ConfirmDialog
                        trigger={<Button variant="outline">Undrain</Button>}
                        title={`Undrain ${row.node.host}?`}
                        description={`${row.node.host} takes new jobs again, and engines placed on it start there.`}
                        confirmLabel="Undrain"
                        onConfirm={() => run("undrain")}
                    />
                ) : (
                    <ConfirmDialog
                        trigger={<Button variant="outline">Drain</Button>}
                        title={`Drain ${row.node.host}?`}
                        description={drainText(row)}
                        confirmLabel="Drain"
                        onConfirm={() => run("drain")}
                    />
                )}
                {blocked ? (
                    <BlockedButton variant="outline" reason={blocked}>
                        Remove from pool
                    </BlockedButton>
                ) : (
                    <RemoveMachineDialog
                        pool={row.pool.name}
                        host={row.node.host}
                        trigger={<Button variant="outline">Remove from pool</Button>}
                        onConfirm={() => run("remove")}
                    />
                )}
            </div>
            <ErrorLine error={action.error} />
        </div>
    );
}
