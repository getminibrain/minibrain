import { useMutation } from "@tanstack/react-query";
import {
    Button,
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    useToast,
} from "obp-ui";
import { useState } from "react";
import type { ModelRow, Placement } from "~/api/client";
import { usePlacements } from "~/api/queries";
import { FormRow, FormRows } from "~/components/FormRows";
import { type PickOption, PickSelect } from "~/components/PickSelect";
import { PoolLink } from "~/components/PoolLink";
import { ErrorLine } from "~/components/Section";
import { DeployBaseDialog } from "../detail/deploy";
import { ModelAvatar } from "../detail/header";
import { AUTO_POOL, NOT_SERVING, fitText, resolvedPool, servesHere } from "../detail/poolPicker";
import { PartialOutcome } from "./PartialOutcome";
import { PartialError, deployRows } from "./actions";
import { plural } from "./model";

type Fit = { target: string | null; text: string; runs: boolean };

function cantRun(row: ModelRow): string | null {
    return row.health?.state === "cant_run" ? row.health.detail : null;
}

function fitOf(placement: Placement | undefined, value: string): Fit {
    if (!placement) {
        return { target: null, text: "Checking pools…", runs: false };
    }
    const target = resolvedPool(placement, value);
    const pool = placement.pools.find((item) => item.name === target);
    if (!target || !pool) {
        return { target: null, text: "Fits in no pool", runs: false };
    }
    const runs = pool.fit.level !== "insufficient" && servesHere(pool, placement.pool);
    return { target, text: fitText(pool), runs };
}

function poolOptions(placements: (Placement | undefined)[]): PickOption[] {
    const known = placements.filter((item): item is Placement => Boolean(item));
    const names = known[0]?.pools.map((pool) => pool.name) ?? [];
    const described = new Map(known[0]?.pools.map((pool) => [pool.name, pool.description]));
    const closed = new Set(known[0]?.pools.filter((pool) => pool.refused).map((pool) => pool.name));
    const fitting = (name: string) => known.filter((item) => fitOf(item, name).runs).length;
    return [
        {
            value: AUTO_POOL,
            label: "Automatic",
            meta: "Where each one fits",
        },
        ...names.map((name, index) => ({
            value: name,
            label: name,
            meta: closed.has(name) ? NOT_SERVING : `${fitting(name)} of ${known.length} fit`,
            description: described.get(name) ?? undefined,
            disabled: fitting(name) === 0,
            separated: index === 0,
        })),
    ];
}

function RowFit({ row, fit }: { row: ModelRow; fit: Fit }) {
    const reason = cantRun(row);
    return (
        <li className="flex min-h-10 items-center gap-3 px-3 py-1.5">
            <ModelAvatar row={row} size="sm" />
            <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate">{row.variant_label ?? row.name}</span>
                <span className="truncate font-mono text-sm text-muted-foreground">{row.key}</span>
                {reason && <span className="text-sm text-muted-foreground">{reason}</span>}
            </span>
            {reason ? (
                <span className="shrink-0 text-sm text-destructive">
                    {`Skipped: ${row.health?.label ?? "can't run here"}`}
                </span>
            ) : (
                <span
                    className={
                        fit.runs
                            ? "shrink-0 text-sm text-muted-foreground"
                            : "shrink-0 text-sm text-destructive"
                    }
                >
                    {fit.target && (
                        <>
                            <PoolLink name={fit.target} />
                            {" · "}
                        </>
                    )}
                    {fit.text}
                </span>
            )}
        </li>
    );
}

function BulkDeployDialog({
    rows,
    onOpenChange,
    after,
}: {
    rows: ModelRow[];
    onOpenChange: (open: boolean) => void;
    after: () => Promise<unknown>;
}) {
    const toast = useToast();
    const [pool, setPool] = useState(AUTO_POOL);
    const placements = usePlacements(
        rows.map((row) => row.key),
        true,
    );
    const known = placements.map((query) => query.data);
    const fits = rows.map((row, index) => ({ row, fit: fitOf(known[index], pool) }));
    const cannot = rows.filter((row) => cantRun(row) !== null).length;
    const runnable = fits
        .filter((item) => item.fit.runs && cantRun(item.row) === null)
        .map((item) => item.row);
    const loading = placements.some((query) => query.isPending);
    const deploy = useMutation({
        mutationFn: async () => {
            try {
                await deployRows(runnable, true, pool);
            } finally {
                await after();
            }
        },
        onSuccess: () => {
            onOpenChange(false);
            toast({ title: `${plural(runnable.length, "model")} deployed`, tone: "success" });
        },
    });
    const skipped = rows.length - runnable.length - cannot;
    const outcome = deploy.error instanceof PartialError ? deploy.error : null;
    if (outcome) {
        return (
            <Dialog open onOpenChange={onOpenChange}>
                <DialogContent className="sm:max-w-lg">
                    <DialogHeader>
                        <DialogTitle>Some could not be deployed</DialogTitle>
                        <DialogDescription>
                            The list shows what is deployed now. Fix the reasons below, then deploy
                            them again.
                        </DialogDescription>
                    </DialogHeader>
                    <PartialOutcome outcome={outcome} done="Deployed" failed="Could not deploy" />
                    <DialogFooter>
                        <Button variant="outline" onClick={() => onOpenChange(false)}>
                            Close
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        );
    }
    return (
        <Dialog open onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-xl">
                <DialogHeader>
                    <DialogTitle>{`Deploy ${plural(rows.length, "variant")}?`}</DialogTitle>
                    <DialogDescription>
                        Each becomes callable on the OpenAI-compatible API with its own keys.
                    </DialogDescription>
                </DialogHeader>
                <FormRows labels="narrow">
                    <FormRow id="bulk-deploy-pool" label="Pool">
                        <PickSelect
                            id="bulk-deploy-pool"
                            compact
                            value={pool}
                            options={poolOptions(known)}
                            onChange={setPool}
                        />
                    </FormRow>
                </FormRows>
                <ul className="flex max-h-72 flex-col divide-y overflow-y-auto rounded-md border">
                    {fits.map(({ row, fit }) => (
                        <RowFit key={row.key} row={row} fit={fit} />
                    ))}
                </ul>
                {!loading && (skipped > 0 || cannot > 0) && (
                    <p className="text-sm text-muted-foreground">
                        {[
                            skipped > 0 &&
                                `${plural(skipped, "variant")} ${skipped === 1 ? "does" : "do"} not fit there and ${skipped === 1 ? "stays" : "stay"} undeployed.`,
                            cannot > 0 &&
                                `${plural(cannot, "variant")} ${cannot === 1 ? "is" : "are"} skipped: ${cannot === 1 ? "it" : "they"} can't run here.`,
                        ]
                            .filter(Boolean)
                            .join(" ")}
                    </p>
                )}
                <ErrorLine error={deploy.error ?? placements.find((query) => query.error)?.error} />
                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)}>
                        Cancel
                    </Button>
                    <Button
                        disabled={loading || runnable.length === 0 || deploy.isPending}
                        onClick={() => deploy.mutate()}
                    >
                        {runnable.length === rows.length
                            ? "Deploy"
                            : `Deploy ${plural(runnable.length, "variant")}`}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

export function DeployRowsDialog({
    rows,
    onOpenChange,
    after,
}: {
    rows: ModelRow[] | null;
    onOpenChange: (open: boolean) => void;
    after: () => Promise<unknown>;
}) {
    if (!rows || rows.length === 0) {
        return null;
    }
    if (rows.length === 1) {
        return <DeployBaseDialog row={rows[0]} open onOpenChange={onOpenChange} after={after} />;
    }
    return <BulkDeployDialog rows={rows} onOpenChange={onOpenChange} after={after} />;
}
