import { type ModelRow, api, removed, unwrap } from "~/api/client";
import { builtOn, deleteModel, rowId, setDeployed } from "~/lib/teardown";
import type { Entry } from "../entries";

function deleteVersion(row: ModelRow, number: number, cancelJobs: boolean) {
    return removed(
        api.DELETE("/api/models/{name}/versions/{number}", {
            params: { path: { name: row.key, number }, query: { cancel_jobs: cancelJobs } },
        }),
    );
}

export function retryDownload(row: ModelRow) {
    return unwrap(api.POST("/api/models/{name}/retry", { params: { path: { name: row.key } } }));
}

export async function deployRows(
    rows: ModelRow[],
    deployed: boolean,
    pool?: string,
): Promise<void> {
    await runAll(
        rows.map((row) => ({
            name: row.variant_label ?? row.name,
            run: () => setDeployed(row, deployed, pool),
        })),
        deployed ? "deployed" : "undeployed",
    );
}

function unique(rows: ModelRow[]): ModelRow[] {
    return [...new Map(rows.map((row) => [rowId(row), row])).values()];
}

function cascading(whole: ModelRow[], rows: ModelRow[], cascade: boolean): Set<string> {
    const wholeKeys = new Set(whole.map(rowId));
    return new Set(
        whole
            .filter((row) => row.kind === "base")
            .filter((row) => {
                const built = builtOn(rows, row);
                return (
                    built.length > 0 &&
                    (cascade || built.every((item) => wholeKeys.has(rowId(item))))
                );
            })
            .map((row) => row.key),
    );
}

export type StepFailure = { name: string; error: string };

export class PartialError extends Error {
    done: string[];
    failed: StepFailure[];

    constructor(verb: string, done: string[], failed: StepFailure[]) {
        super(`${failed.length} of ${done.length + failed.length} could not be ${verb}`);
        this.done = done;
        this.failed = failed;
    }
}

type Step = { name: string; run: () => Promise<unknown> };

async function runAll(steps: Step[], verb: string): Promise<void> {
    const done: string[] = [];
    const failed: StepFailure[] = [];
    for (const step of steps) {
        try {
            await step.run();
            done.push(step.name);
        } catch (error) {
            failed.push({
                name: step.name,
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }
    if (failed.length > 0) {
        throw new PartialError(verb, done, failed);
    }
}

export async function deleteEntries(
    chosen: Entry[],
    rows: ModelRow[],
    cascade: boolean,
    cancelJobs: boolean,
): Promise<void> {
    const whole = unique(chosen.filter((entry) => !entry.version).map((entry) => entry.model));
    const wholeKeys = new Set(whole.map(rowId));
    const dropped = cascading(whole, rows, cascade);
    const versions = chosen.filter(
        (entry) =>
            entry.version &&
            !wholeKeys.has(rowId(entry.model)) &&
            !dropped.has(entry.model.base_model ?? ""),
    );
    const steps: Step[] = versions.map((entry) => ({
        name: `${entry.model.name} v${entry.version?.number ?? 0}`,
        run: () => deleteVersion(entry.model, entry.version?.number ?? 0, cancelJobs),
    }));
    for (const row of whole) {
        if (row.kind === "custom" && dropped.has(row.base_model ?? "")) {
            continue;
        }
        steps.push({
            name: row.name,
            run: () =>
                deleteModel(row, { undeploy: true, cascade: dropped.has(row.key), cancelJobs }),
        });
    }
    await runAll(steps, "deleted");
}
