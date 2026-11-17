import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter, useRouterState } from "@tanstack/react-router";
import type { ColumnDef } from "@tanstack/react-table";
import {
    Button,
    DataGrid,
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    Link,
    Tooltip,
    TooltipContent,
    TooltipTrigger,
} from "obp-ui";
import { useState } from "react";
import { type DatasetSummary, api, unwrap } from "~/api/client";
import {
    type ChangeInfo,
    type DatasetVersionInfo,
    dataKeys,
    useDatasetVersions,
} from "~/api/dataQueries";
import { keys } from "~/api/queries";
import { ErrorLine } from "~/components/Section";
import { When } from "~/components/When";
import { StatusText } from "~/components/models/StatusText";
import { useCan } from "~/lib/access";
import { count } from "~/lib/format";
import { bytes, relativeTime } from "~/lib/time";
import {
    SampleOffer,
    type SampleRequest,
    overLimitOf,
    sampleText,
    useOverLimit,
} from "./SampleOffer";
import { VersionDiffDialog, compareParam, parseCompare, versionName } from "./VersionDiff";
import { modelHref, useModelNames } from "./parts";

export function takenAt(datasetVersion: DatasetVersionInfo): string {
    return datasetVersion.taken_at ?? datasetVersion.created_at;
}

export function shortId(datasetVersion: DatasetVersionInfo): string {
    return datasetVersion.hash.slice(0, 12);
}

function shortName(datasetVersion: DatasetVersionInfo): string {
    return datasetVersion.number === null || datasetVersion.number === undefined
        ? versionName(datasetVersion)
        : `v${datasetVersion.number}`;
}

export function changeText(
    changed: ChangeInfo | null | undefined,
    datasetVersion: DatasetVersionInfo,
): string | null {
    if (!changed) {
        return null;
    }
    const since = shortName(datasetVersion);
    if (changed.dataset) {
        return `The model now uses another dataset than ${since}`;
    }
    if (changed.data && changed.query) {
        return `Sources and query changed since ${since}`;
    }
    if (changed.data) {
        return `Sources changed since ${since}`;
    }
    return changed.query ? `Query changed since ${since}` : null;
}

export function useVersionRefresh(slug: string) {
    const client = useQueryClient();
    return () =>
        Promise.all([
            client.invalidateQueries({ queryKey: dataKeys.datasetVersions(slug) }),
            client.invalidateQueries({ queryKey: keys.dataset(slug) }),
            client.invalidateQueries({ queryKey: keys.datasets, exact: true }),
            client.invalidateQueries({ queryKey: ["model"] }),
            client.invalidateQueries({ queryKey: ["infrastructure"] }),
        ]);
}

export function useSaveVersion(dataset: string) {
    const refresh = useVersionRefresh(dataset);
    return useMutation({
        mutationFn: (sample?: SampleRequest) =>
            unwrap(
                api.POST("/api/datasets/{slug}/versions", {
                    params: { path: { slug: dataset } },
                    body: sample ? { sample } : null,
                }),
            ),
        onSuccess: refresh,
    });
}

export function UpdateVersion({
    dataset,
    label = "Update",
    seed,
}: { dataset: string; label?: string; seed?: number | null }) {
    const update = useSaveVersion(dataset);
    const over = useOverLimit(update.error, update.isPending && Boolean(update.variables));
    return (
        <>
            <Button
                variant="outline"
                size="sm"
                onClick={() => update.mutate(undefined)}
                disabled={update.isPending}
            >
                {update.isPending ? "Saving…" : label}
            </Button>
            {over ? (
                <div className="basis-full">
                    <SampleOffer
                        total={over.total_rows}
                        limit={over.row_limit}
                        seed={seed}
                        pending={update.isPending}
                        onTake={(sample) => update.mutate(sample)}
                    />
                </div>
            ) : (
                <ErrorLine error={update.error} />
            )}
        </>
    );
}

export function ChangeNotice({
    changed,
    datasetVersion,
    dataset,
    after,
}: {
    changed: ChangeInfo | null | undefined;
    datasetVersion: DatasetVersionInfo | null | undefined;
    dataset?: string | null;
    after?: string;
}) {
    const can = useCan();
    const text = datasetVersion ? changeText(changed, datasetVersion) : null;
    if (!text || !datasetVersion) {
        return null;
    }
    return (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <p>
                <StatusText tone="warning">{text}</StatusText>
                <span className="text-muted-foreground">
                    {` · ${shortName(datasetVersion)} saved ${relativeTime(takenAt(datasetVersion))}. ${after ?? "Update to save the next version."}`}
                </span>
            </p>
            {dataset && can.build && (
                <UpdateVersion dataset={dataset} seed={datasetVersion.sample?.seed} />
            )}
        </div>
    );
}

export function FirstVersionNotice({ dataset }: { dataset: DatasetSummary }) {
    if (dataset.dataset_version || !dataset.mapping.sql || needsSample(dataset)) {
        return null;
    }
    return (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <p>
                <StatusText tone="warning">No version yet</StatusText>
                <span className="text-muted-foreground">
                    {" · Models train and score on a saved version of the rows."}
                </span>
            </p>
            <UpdateVersion dataset={dataset.slug} label="Save version 1" />
        </div>
    );
}

export function needsSample(dataset: DatasetSummary): boolean {
    const rows = dataset.rows ?? null;
    const limit = dataset.row_limit ?? 0;
    if (rows === null || limit <= 0 || rows <= limit) {
        return false;
    }
    const sampled = dataset.dataset_version?.sample;
    const current = sampled && !dataset.changed?.data && !dataset.changed?.query;
    return !current;
}

export function RowLimitNotice({ dataset }: { dataset: DatasetSummary }) {
    const can = useCan();
    const save = useSaveVersion(dataset.slug);
    const sampled = dataset.dataset_version?.sample;
    if (!needsSample(dataset) || !can.build) {
        return null;
    }
    return (
        <SampleOffer
            subject="dataset"
            total={dataset.rows ?? 0}
            limit={dataset.row_limit ?? 0}
            seed={sampled?.seed}
            pending={save.isPending}
            error={overLimitOf(save.error) ? null : save.error}
            onTake={(sample) => save.mutate(sample)}
        />
    );
}

function VersionRows({ datasetVersion }: { datasetVersion: DatasetVersionInfo }) {
    const { sample } = datasetVersion;
    if (!sample) {
        return <span className="tabular-nums">{count(datasetVersion.rows)}</span>;
    }
    return (
        <Tooltip>
            <TooltipTrigger asChild>
                <span className="tabular-nums">{`${count(datasetVersion.rows)} sampled`}</span>
            </TooltipTrigger>
            <TooltipContent>{sampleText(sample)}</TooltipContent>
        </Tooltip>
    );
}

function UsedBy({ datasetVersion }: { datasetVersion: DatasetVersionInfo }) {
    const nameOf = useModelNames();
    if (datasetVersion.versions.length === 0) {
        return <span className="text-muted-foreground">–</span>;
    }
    return (
        <span className="flex min-w-0 flex-wrap gap-x-2">
            {datasetVersion.versions.map((tag) => {
                const [slug, number] = tag.split("@");
                return (
                    <Link key={tag} href={modelHref(slug)} className="truncate text-primary">
                        {`${nameOf(slug)} v${number}`}
                    </Link>
                );
            })}
        </span>
    );
}

function openWarnings(datasetVersion: DatasetVersionInfo): number | undefined {
    const checks = datasetVersion.checks ?? [];
    if (checks.length === 0) {
        return undefined;
    }
    return checks.filter((check) => check.status === "warning" && !check.dismissed).length;
}

function ChecksSummary({ datasetVersion }: { datasetVersion: DatasetVersionInfo }) {
    const open = openWarnings(datasetVersion);
    if (open === undefined) {
        return <span className="text-muted-foreground">Not run</span>;
    }
    return open === 0 ? (
        <StatusText tone="success">Passed</StatusText>
    ) : (
        <StatusText tone="warning">
            {open === 1 ? "1 warning" : `${count(open)} warnings`}
        </StatusText>
    );
}

const VERSION_COLUMNS: ColumnDef<DatasetVersionInfo, unknown>[] = [
    {
        id: "version",
        header: "Version",
        accessorFn: (datasetVersion) => datasetVersion.number ?? 0,
        cell: ({ row }) => (
            <span className="font-semibold tabular-nums">{`Version ${row.original.number}`}</span>
        ),
    },
    {
        id: "taken",
        header: "Saved",
        accessorFn: (datasetVersion) => Date.parse(takenAt(datasetVersion)),
        cell: ({ row }) => <When value={takenAt(row.original)} />,
    },
    {
        id: "rows",
        header: "Rows",
        accessorFn: (datasetVersion) => datasetVersion.rows,
        cell: ({ row }) => <VersionRows datasetVersion={row.original} />,
    },
    {
        id: "labels",
        header: "Labels",
        accessorFn: (datasetVersion) => datasetVersion.labels.length,
        cell: ({ row }) => (
            <span className="tabular-nums">{count(row.original.labels.length)}</span>
        ),
    },
    {
        id: "checks",
        header: "Checks",
        accessorFn: (datasetVersion) => openWarnings(datasetVersion),
        sortUndefined: "last",
        cell: ({ row }) => <ChecksSummary datasetVersion={row.original} />,
    },
    {
        id: "used",
        header: "Used by",
        accessorFn: (datasetVersion) => datasetVersion.versions.length,
        cell: ({ row }) => <UsedBy datasetVersion={row.original} />,
    },
    {
        id: "size",
        header: "Size",
        accessorFn: (datasetVersion) => datasetVersion.size,
        cell: ({ row }) => <span className="tabular-nums">{bytes(row.original.size)}</span>,
    },
    {
        id: "id",
        header: "SHA-256",
        accessorFn: (datasetVersion) => datasetVersion.hash,
        enableSorting: false,
        cell: ({ row }) => (
            <span className="font-mono text-muted-foreground">{shortId(row.original)}</span>
        ),
    },
];

function ordered(pair: string[], datasetVersions: DatasetVersionInfo[]): [number, number] | null {
    const picked = datasetVersions.filter((datasetVersion) =>
        pair.includes(String(datasetVersion.id)),
    );
    if (picked.length !== 2) {
        return null;
    }
    const [older, newer] = picked.sort((left, right) => (left.number ?? 0) - (right.number ?? 0));
    return [older.id, newer.id];
}

function useCompareParam() {
    const router = useRouter();
    const requested = useRouterState({
        select: (state) => parseCompare((state.location.search as { compare?: unknown }).compare),
    });
    const set = (pair: [number, number] | null) => {
        const params = new URLSearchParams(window.location.search);
        if (pair) {
            params.set("compare", compareParam(pair[0], pair[1]));
        } else {
            params.delete("compare");
        }
        router.history.replace(`/data?${params.toString()}`);
    };
    return { requested, set };
}

function AllVersionsDialog({
    rows,
    loading,
    open,
    onOpenChange,
    onCompare,
}: {
    rows: DatasetVersionInfo[];
    loading: boolean;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onCompare: (pair: [number, number]) => void;
}) {
    const [selected, setSelected] = useState<string[]>([]);
    const pair = ordered(selected, rows);
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-5xl">
                <DialogHeader>
                    <DialogTitle>Versions</DialogTitle>
                    <DialogDescription>
                        Saved copies of the query's rows, newest first. Models train and score on a
                        version: saving the query or Update makes the next one, and identical rows
                        are stored once. Tick two to compare them.
                    </DialogDescription>
                </DialogHeader>
                <DataGrid
                    columns={VERSION_COLUMNS}
                    rows={rows}
                    getRowId={(datasetVersion) => String(datasetVersion.id)}
                    selectedIds={selected}
                    onSelectedIdsChange={(ids) => setSelected(ids.slice(-2))}
                    loading={loading}
                    loadingRows={2}
                    maxHeight="420px"
                    storageKey="minibrain.data.versions"
                    empty="No version yet."
                />
                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)}>
                        Close
                    </Button>
                    <Button disabled={pair === null} onClick={() => pair && onCompare(pair)}>
                        Compare
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

const RECENT_VERSIONS = 3;

function RecentVersion({ datasetVersion }: { datasetVersion: DatasetVersionInfo }) {
    return (
        <li className="flex flex-col gap-0.5 py-2">
            <div className="flex items-baseline gap-2">
                <span className="font-semibold tabular-nums">{`Version ${datasetVersion.number}`}</span>
                <span className="min-w-0 truncate text-sm text-muted-foreground">
                    <When value={takenAt(datasetVersion)} />
                </span>
                <span className="ml-auto shrink-0">
                    <VersionRows datasetVersion={datasetVersion} />
                    <span className="text-muted-foreground"> rows</span>
                </span>
            </div>
            <div className="flex min-w-0 items-center gap-3 text-sm">
                <ChecksSummary datasetVersion={datasetVersion} />
                {datasetVersion.versions.length > 0 && (
                    <span className="min-w-0 truncate">
                        <UsedBy datasetVersion={datasetVersion} />
                    </span>
                )}
            </div>
        </li>
    );
}

export function VersionsPart({ dataset }: { dataset: DatasetSummary }) {
    const datasetVersions = useDatasetVersions(dataset.slug);
    const compare = useCompareParam();
    const [all, setAll] = useState(false);
    const rows = datasetVersions.data ?? [];
    return (
        <>
            <ErrorLine error={datasetVersions.error} onRetry={datasetVersions.refetch} />
            {rows.length === 0 ? (
                <p className="text-muted-foreground">
                    {datasetVersions.isLoading
                        ? "Loading…"
                        : "No version yet. Save the query to make version 1."}
                </p>
            ) : (
                <ul className="flex flex-col divide-y">
                    {rows.slice(0, RECENT_VERSIONS).map((datasetVersion) => (
                        <RecentVersion key={datasetVersion.id} datasetVersion={datasetVersion} />
                    ))}
                </ul>
            )}
            {rows.length > 0 && (
                <div>
                    <Button variant="link" className="h-auto px-0" onClick={() => setAll(true)}>
                        {rows.length > 1
                            ? `All ${count(rows.length)} versions and compare`
                            : "Version details"}
                    </Button>
                </div>
            )}
            <AllVersionsDialog
                rows={rows}
                loading={datasetVersions.isLoading}
                open={all}
                onOpenChange={setAll}
                onCompare={(pair) => {
                    setAll(false);
                    compare.set(pair);
                }}
            />
            <VersionDiffDialog pair={compare.requested} onClose={() => compare.set(null)} />
        </>
    );
}
