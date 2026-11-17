import { IconEraser } from "@tabler/icons-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Button, ConfirmDialog, DataGrid } from "obp-ui";
import type { ReactNode } from "react";
import { api, unwrap } from "~/api/client";
import type { components } from "~/api/schema";
import { ErrorLine, PanelSection } from "~/components/Section";
import { useCan } from "~/lib/access";
import { count } from "~/lib/format";
import { modelPageHref } from "~/lib/modelLinks";
import { bytes } from "~/lib/time";
import { datasetHref } from "~/pages/models/list/cells";
import { TextLink, sourceHref } from "./UsageSection";
import { type InfrastructureInfo, plural } from "./parts";

type FreeUpItem = components["schemas"]["FreeUpItem"];

type FreeRow = {
    key: string;
    what: ReactNode;
    why: string;
    size: number;
    action: ReactNode;
};

const COLUMNS: ColumnDef<FreeRow, unknown>[] = [
    { header: "What", id: "what", size: 260, cell: ({ row }) => row.original.what },
    {
        header: "Why it is safe",
        id: "why",
        size: 420,
        cell: ({ row }) => <span className="text-muted-foreground">{row.original.why}</span>,
    },
    {
        header: "Size",
        id: "size",
        size: 100,
        cell: ({ row }) => <span className="tabular-nums">{bytes(row.original.size)}</span>,
    },
    { header: "Delete", id: "action", size: 180, cell: ({ row }) => row.original.action },
];

function usePurgeLogs() {
    const client = useQueryClient();
    return useMutation({
        mutationFn: (days: number) =>
            unwrap(api.POST("/api/system/job-logs/purge", { body: { older_than_days: days } })),
        onSuccess: () => client.invalidateQueries({ queryKey: ["infrastructure"] }),
    });
}

function PurgeLogs({
    item,
    onPurge,
}: { item: FreeUpItem; onPurge: (days: number) => Promise<unknown> }) {
    const days = item.days ?? 0;
    return (
        <ConfirmDialog
            trigger={
                <Button size="sm" variant="outline">
                    Delete logs
                </Button>
            }
            title={`Delete logs of ${plural(item.count ?? 0, "job")}?`}
            description={`Removes the logs and checkpoints of jobs that finished more than ${count(days)} days ago, about ${bytes(item.size_bytes)}. Their results, versions and history stay; a retry starts from the beginning.`}
            confirmLabel="Delete logs"
            destructive
            onConfirm={() => onPurge(days).catch(() => undefined)}
        />
    );
}

function rowOf(
    item: FreeUpItem,
    admin: boolean,
    keepDays: number,
    onPurge: (days: number) => Promise<unknown>,
): FreeRow {
    const base = { key: `${item.kind}-${item.key}`, size: item.size_bytes };
    if (item.kind === "base") {
        return {
            ...base,
            what: <TextLink href={modelPageHref(item.key)}>{item.name}</TextLink>,
            why: "No model is built on it, it judges and checks nothing, and it is not deployed.",
            action: <TextLink href={modelPageHref(item.key)}>On its page</TextLink>,
        };
    }
    if (item.kind === "dataset") {
        return {
            ...base,
            what: (
                <span>
                    <TextLink href={datasetHref(item.key)}>{item.name}</TextLink>
                    <span className="text-muted-foreground">{` · ${plural(item.count ?? 0, "version")}`}</span>
                </span>
            ),
            why: "No model version trained on these, and none is the dataset's latest.",
            action: <TextLink href="/settings/data">Retention</TextLink>,
        };
    }
    if (item.kind === "source") {
        return {
            ...base,
            what: <TextLink href={sourceHref(item.key)}>{item.name}</TextLink>,
            why: "No dataset uses this upload.",
            action: <TextLink href={sourceHref(item.key)}>On its page</TextLink>,
        };
    }
    const kept = keepDays > 0 ? `; kept ${count(keepDays)} days, then removed` : "";
    return {
        ...base,
        what: `Logs and checkpoints of ${plural(item.count ?? 0, "job")}`,
        why: `Finished over ${count(item.days ?? 0)} days ago; running jobs keep theirs${kept}.`,
        action: admin ? (
            <PurgeLogs item={item} onPurge={onPurge} />
        ) : (
            <span className="text-muted-foreground">An admin can</span>
        ),
    };
}

export function FreeUpSection({ info }: { info: InfrastructureInfo | undefined }) {
    const can = useCan();
    const purge = usePurgeLogs();
    const items = info?.free_up ?? [];
    const rows = items.map((item) =>
        rowOf(item, can.admin, info?.job_log_days ?? 0, (days) => purge.mutateAsync(days)),
    );
    const total = items.reduce((sum, item) => sum + item.size_bytes, 0);
    return (
        <PanelSection
            bare
            icon={IconEraser}
            title="Free up space"
            description={
                rows.length > 0
                    ? `${bytes(total)} could go without breaking any model, dataset or source. Each is deleted on its own page, which refuses anything in use.`
                    : "What could go without breaking any model, dataset or source."
            }
        >
            <div className="flex flex-col gap-3">
                <DataGrid
                    columns={COLUMNS}
                    rows={rows}
                    loading={!info}
                    empty="Nothing to free up: everything stored is in use."
                />
                <ErrorLine error={purge.error} />
            </div>
        </PanelSection>
    );
}
