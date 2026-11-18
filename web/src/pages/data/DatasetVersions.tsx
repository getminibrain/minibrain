import {
    IconChevronDown,
    IconDeviceFloppy,
    IconGitCompare,
    IconHistory,
} from "@tabler/icons-react";
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
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuRadioGroup,
    DropdownMenuRadioItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
    Link,
    StatusDot,
    type StatusDotTone,
    Tooltip,
    TooltipContent,
    TooltipTrigger,
} from "obp-ui";
import { useId, useState } from "react";
import { type DatasetSummary, api, unwrap } from "~/api/client";
import { type ChangeInfo, type DatasetVersionInfo, dataKeys } from "~/api/dataQueries";
import { keys } from "~/api/queries";
import { BlockedButton } from "~/components/BlockedButton";
import { ErrorLine } from "~/components/Section";
import { When } from "~/components/When";
import { StatusText } from "~/components/models/StatusText";
import { useCan } from "~/lib/access";
import { count } from "~/lib/format";
import { bytes, relativeTime, timeText } from "~/lib/time";
import {
    SampleOffer,
    type SampleRequest,
    overLimitOf,
    sampleText,
    useOverLimit,
} from "./SampleOffer";
import { VersionDiffDialog, compareParam, parseCompare, versionName } from "./VersionDiff";
import { datasetHref, datasetVersionHref } from "./catalogue";
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

export type SaveVersion = ReturnType<typeof useSaveVersion>;

export function fullVersionBlock(dataset: DatasetSummary): string | null {
    const rows = dataset.rows ?? null;
    const limit = dataset.row_limit ?? 0;
    if (rows === null) {
        return "The query fails, so its rows cannot be counted.";
    }
    if (limit > 0 && rows > limit) {
        return `The query returns ${count(rows)} rows, over the ${count(limit)}-row limit.`;
    }
    return null;
}

const FULL_VERSION = "Save full version";

export function SampleLine({ dataset, save }: { dataset: DatasetSummary; save: SaveVersion }) {
    const can = useCan();
    const sample = dataset.dataset_version?.sample;
    if (!sample) {
        return null;
    }
    const blocked = fullVersionBlock(dataset);
    return (
        <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <p className="text-muted-foreground tabular-nums">{sampleText(sample)}</p>
                {can.build &&
                    (blocked ? (
                        <BlockedButton reason={blocked} variant="outline" size="sm">
                            {FULL_VERSION}
                        </BlockedButton>
                    ) : (
                        <Button
                            variant="outline"
                            size="sm"
                            disabled={save.isPending}
                            onClick={() => save.mutate(undefined)}
                        >
                            {save.isPending ? "Saving…" : FULL_VERSION}
                        </Button>
                    ))}
            </div>
            <ErrorLine error={save.error} />
        </div>
    );
}

export function FullVersionItem({ dataset, save }: { dataset: DatasetSummary; save: SaveVersion }) {
    const reason = useId();
    if (!dataset.dataset_version?.sample) {
        return null;
    }
    const blocked = fullVersionBlock(dataset);
    return (
        <>
            <DropdownMenuItem
                disabled={blocked !== null || save.isPending}
                aria-describedby={blocked ? reason : undefined}
                onSelect={() => save.mutate(undefined)}
            >
                <IconDeviceFloppy />
                {FULL_VERSION}
            </DropdownMenuItem>
            {blocked && (
                <p id={reason} className="pr-2.5 pb-1.5 pl-9 text-sm text-muted-foreground">
                    {blocked}
                </p>
            )}
        </>
    );
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

export function useCompareParam() {
    const router = useRouter();
    const requested = useRouterState({
        select: (state) => parseCompare((state.location.search as { compare?: unknown }).compare),
    });
    const set = (pair: [number, number] | null) => {
        const { pathname, searchStr } = router.state.location;
        const params = new URLSearchParams(searchStr);
        if (pair) {
            params.set("compare", compareParam(pair[0], pair[1]));
        } else {
            params.delete("compare");
        }
        const search = params.toString();
        router.history.replace(`${pathname}${search ? `?${search}` : ""}`);
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

function checkTone(datasetVersion: DatasetVersionInfo): StatusDotTone {
    const open = openWarnings(datasetVersion);
    if (open === undefined) {
        return "muted";
    }
    return open === 0 ? "success" : "warning";
}

function checkLabel(datasetVersion: DatasetVersionInfo): string {
    const open = openWarnings(datasetVersion);
    if (open === undefined) {
        return "Checks not run";
    }
    if (open === 0) {
        return "Checks passed";
    }
    return open === 1 ? "1 warning" : `${count(open)} warnings`;
}

export function versionTitle(number: number, latest: number | undefined): string {
    return number === latest ? `v${number} · latest` : `v${number}`;
}

export function VersionPicker({
    slug,
    current,
    versions,
}: {
    slug: string;
    current: number | null;
    versions: DatasetVersionInfo[];
}) {
    const router = useRouter();
    const compare = useCompareParam();
    const [all, setAll] = useState(false);
    const latest = versions[0]?.number ?? undefined;
    const shown = current ?? latest;
    if (shown === undefined || shown === null) {
        return null;
    }
    const open = (number: number) =>
        router.history.push(
            number === latest ? datasetHref(slug) : datasetVersionHref(slug, number),
        );
    return (
        <>
            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <Button variant="outline" aria-label={`Version ${shown}, pick another`}>
                        <IconHistory aria-hidden="true" />
                        <span className="tabular-nums">{versionTitle(shown, latest)}</span>
                        <IconChevronDown aria-hidden="true" />
                    </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="max-h-96 w-80">
                    <DropdownMenuRadioGroup
                        value={String(shown)}
                        onValueChange={(value) => open(Number(value))}
                    >
                        {versions.map((item) =>
                            item.number === null || item.number === undefined ? null : (
                                <DropdownMenuRadioItem key={item.id} value={String(item.number)}>
                                    <span className="tabular-nums">
                                        {versionTitle(item.number, latest)}
                                    </span>
                                    <span className="ml-auto flex items-center gap-3 text-sm text-muted-foreground tabular-nums">
                                        <span>{timeText(takenAt(item))}</span>
                                        <span>{`${count(item.rows)} rows`}</span>
                                        <StatusDot
                                            tone={checkTone(item)}
                                            label={checkLabel(item)}
                                            className="shrink-0"
                                        />
                                    </span>
                                </DropdownMenuRadioItem>
                            ),
                        )}
                    </DropdownMenuRadioGroup>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem disabled={versions.length < 2} onSelect={() => setAll(true)}>
                        <IconGitCompare />
                        Compare versions…
                    </DropdownMenuItem>
                </DropdownMenuContent>
            </DropdownMenu>
            <AllVersionsDialog
                rows={versions}
                loading={false}
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
