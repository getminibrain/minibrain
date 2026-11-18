import { IconEraser, IconTrash } from "@tabler/icons-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button, ConfirmDialog } from "obp-ui";
import type { ReactNode } from "react";
import { api, unwrap } from "~/api/client";
import type { components } from "~/api/schema";
import { ErrorLine, PanelSection } from "~/components/Section";
import { useCan } from "~/lib/access";
import { count } from "~/lib/format";
import { modelPageHref } from "~/lib/modelLinks";
import { bytes } from "~/lib/time";
import { datasetHref, uploadHref } from "~/pages/data/catalogue";
import { TextLink } from "./UsageSection";
import { type InfrastructureInfo, plural } from "./parts";

type FreeUpItem = components["schemas"]["FreeUpItem"];

type FreeRow = {
    key: string;
    what: ReactNode;
    why: string;
    size: number;
    action: ReactNode;
};

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
                <Button size="sm" variant="destructive">
                    <IconTrash />
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
            action: <TextLink href={modelPageHref(item.key)}>Delete on its page</TextLink>,
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
            action: <TextLink href="/settings/data">Set retention</TextLink>,
        };
    }
    if (item.kind === "source") {
        return {
            ...base,
            what: <TextLink href={uploadHref(item.key)}>{item.name}</TextLink>,
            why: "No dataset uses this upload.",
            action: <TextLink href={uploadHref(item.key)}>Delete on its page</TextLink>,
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

function FreeRowLine({ row }: { row: FreeRow }) {
    return (
        <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 px-4 py-2.5">
            <span className="min-w-0 truncate">{row.what}</span>
            <span className="text-right tabular-nums">{bytes(row.size)}</span>
            <span className="min-w-0 text-sm text-muted-foreground">{row.why}</span>
            <span className="justify-self-end text-sm">{row.action}</span>
        </div>
    );
}

function FreeUpBody({ rows, loading }: { rows: FreeRow[]; loading: boolean }) {
    if (loading) {
        return <p className="px-4 py-3 text-muted-foreground">…</p>;
    }
    if (rows.length === 0) {
        return (
            <p className="px-4 py-3 text-muted-foreground">
                Nothing to free up: everything stored is in use.
            </p>
        );
    }
    return (
        <div className="flex flex-col divide-y">
            {rows.map((row) => (
                <FreeRowLine key={row.key} row={row} />
            ))}
        </div>
    );
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
            flush
            icon={IconEraser}
            title="Free up space"
            description={
                rows.length > 0
                    ? `${bytes(total)} could go without breaking any model, dataset or source.`
                    : "What could go without breaking any model, dataset or source."
            }
            tip="Each is deleted on its own page, which refuses anything in use."
        >
            <FreeUpBody rows={rows} loading={!info} />
            {purge.error ? (
                <div className="border-t px-4 py-3">
                    <ErrorLine error={purge.error} />
                </div>
            ) : null}
        </PanelSection>
    );
}
