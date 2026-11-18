import { IconFolderDown, IconPencil, IconSchool } from "@tabler/icons-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import type { ColumnDef } from "@tanstack/react-table";
import {
    Button,
    CodeBlock,
    ConfirmDialog,
    DataGrid,
    DropdownMenuItem,
    Link,
    Tooltip,
    TooltipContent,
    TooltipTrigger,
} from "obp-ui";
import { ChatBubble, type ChatRole } from "obp-ui/chat";
import { type ReactNode, useState } from "react";
import {
    type DatasetSummary,
    type PreviewResponse,
    type SourceSummary,
    api,
    succeed,
} from "~/api/client";
import {
    type DatasetVersionInfo,
    type DatasetVersionStats,
    useDatasetVersionStats,
    useDatasetVersions,
} from "~/api/dataQueries";
import { keys, useAllModels, useDatasetPreview } from "~/api/queries";
import { BlockedButton } from "~/components/BlockedButton";
import { PublisherLogo } from "~/components/PublisherLogo";
import { ErrorLine } from "~/components/Section";
import { datasetDeleteNote } from "~/lib/datasetUse";
import { asCode, count } from "~/lib/format";
import { modelVersionHref } from "~/lib/modelLinks";
import { relativeTime } from "~/lib/time";
import { ChecksList, checksCaption } from "./Checks";
import { MoveDialog, type MoveTarget, PathLinks, folderRef } from "./DatasetFolders";
import {
    ChangeNotice,
    FirstVersionNotice,
    FullVersionItem,
    RowLimitNotice,
    SampleLine,
    VersionPicker,
    needsSample,
    useSaveVersion,
    useVersionRefresh,
} from "./DatasetVersions";
import { Clamp, QUERY_HELP } from "./QueryEditor";
import { RowsPreview } from "./RowsPreview";
import { type FolderIndex, type ItemRef, datasetEditHref, itemHref, sourceRef } from "./catalogue";
import {
    AboutPart,
    DeleteMenuItem,
    Fact,
    Facts,
    ItemHeader,
    ItemMenu,
    LabelBalance,
    PartAction,
    SplitDetail,
    modelHref,
    useDataRefresh,
    useModelNames,
} from "./parts";
import { naturalSort } from "./resultColumns";

const SPLITS: [string, string][] = [
    ["train", "Training"],
    ["eval", "Held-out"],
    ["golden", "Test set"],
    ["shots", "Few-shot"],
];

export const LABEL_BALANCE_TIP =
    "Rows per label in the saved version, the rows a model trains on. Rare labels are the ones a model gets wrong.";

export function useDatasetRefresh(slug: string) {
    const client = useQueryClient();
    const refresh = useDataRefresh();
    const versions = useVersionRefresh(slug);
    return async () => {
        await Promise.all([
            client.invalidateQueries({ queryKey: keys.dataset(slug) }),
            client.invalidateQueries({ queryKey: keys.datasetPreview(slug) }),
            versions(),
            refresh(),
        ]);
    };
}

function QueryPart({
    dataset,
    sources,
    onEdit,
}: {
    dataset: DatasetSummary;
    sources: SourceSummary[];
    onEdit: () => void;
}) {
    const { mapping } = dataset;
    const source = sources.find((item) => item.id === dataset.source_id);
    let body: ReactNode;
    if (!mapping.sql) {
        body = (
            <p className="text-muted-foreground">
                No query yet.{" "}
                <Link
                    href={datasetEditHref(dataset.slug, "query")}
                    className="text-primary hover:underline"
                >
                    Edit the query
                </Link>{" "}
                to pick the columns.
            </p>
        );
    } else if (dataset.mode === "columns" && source) {
        body = (
            <dl className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-x-3 gap-y-1.5">
                <dt className="text-muted-foreground">Source</dt>
                <dd className="truncate">
                    <Link
                        href={itemHref(sourceRef(source))}
                        className="text-primary hover:underline"
                    >
                        {source.name}
                    </Link>
                </dd>
                <dt className="text-muted-foreground">Input</dt>
                <dd className="truncate font-mono">{mapping.input_column ?? "–"}</dd>
                <dt className="text-muted-foreground">Label</dt>
                <dd className="truncate font-mono">{mapping.label_column ?? "–"}</dd>
            </dl>
        );
    } else {
        body = (
            <CodeBlock
                code={mapping.sql}
                language="sql"
                copyLabel="Copy the query"
                wrap
                className="max-h-56"
            />
        );
    }
    return (
        <AboutPart
            title="Query"
            tip={QUERY_HELP}
            action={
                <PartAction label="Edit query" onClick={onEdit}>
                    <IconPencil />
                </PartAction>
            }
        >
            {body}
        </AboutPart>
    );
}

function TestExampleNote({ count: total }: { count: number }) {
    if (total === 0) {
        return null;
    }
    const examples = `${count(total)} test ${total === 1 ? "example" : "examples"}`;
    return (
        <Tooltip>
            <TooltipTrigger asChild>
                <span className="shrink-0 cursor-default text-sm text-muted-foreground tabular-nums">
                    {`+${examples}`}
                </span>
            </TooltipTrigger>
            <TooltipContent className="max-w-xs whitespace-normal">
                {`Adds ${examples} from the Playground to the held-out rows of its next version.`}
            </TooltipContent>
        </Tooltip>
    );
}

function newestVersions(versions: DatasetVersionInfo[]): Map<string, number> {
    const newest = new Map<string, number>();
    for (const tag of versions.flatMap((item) => item.versions)) {
        const [slug, number] = tag.split("@");
        newest.set(slug, Math.max(newest.get(slug) ?? 0, Number(number)));
    }
    return newest;
}

function UsedBy({
    dataset,
    versions,
}: {
    dataset: DatasetSummary;
    versions: DatasetVersionInfo[];
}) {
    const newest = newestVersions(versions);
    const nameOf = useModelNames();
    const models = useAllModels();
    const avatarOf = (slug: string) =>
        (models.data ?? []).find((row) => row.key === slug)?.avatar ?? null;
    return (
        <AboutPart title="Used by" tip="Models that train on this dataset.">
            {dataset.models.length === 0 ? (
                <p className="text-muted-foreground">No model trains on it yet.</p>
            ) : (
                <ul className="flex flex-col">
                    {dataset.models.map((slug) => (
                        <li key={slug} className="flex h-8 items-center gap-2">
                            <PublisherLogo
                                name={nameOf(slug)}
                                custom
                                avatar={avatarOf(slug)}
                                size="sm"
                            />
                            <Link
                                href={modelHref(slug)}
                                className="min-w-0 flex-1 truncate text-primary hover:underline"
                            >
                                {nameOf(slug)}
                            </Link>
                            <TestExampleNote count={dataset.test_examples?.[slug] ?? 0} />
                            {newest.has(slug) && (
                                <Link
                                    href={modelVersionHref(slug, newest.get(slug) ?? 0)}
                                    className="shrink-0 text-primary tabular-nums hover:underline"
                                >
                                    {`v${newest.get(slug)}`}
                                </Link>
                            )}
                        </li>
                    ))}
                </ul>
            )}
        </AboutPart>
    );
}

function splitsNote(dataset: DatasetSummary): string | null {
    const latest = dataset.dataset_version;
    if (!latest) {
        return "The first version sets the splits.";
    }
    return latest.too_few_rows ?? null;
}

function liveRowsNote(dataset: DatasetSummary): string | null {
    const live = dataset.rows ?? null;
    const latest = dataset.dataset_version;
    const saved = latest ? (latest.sample?.total ?? latest.rows) : null;
    if (live === null || live === saved) {
        return null;
    }
    return `The query now returns ${count(live)} rows; save a version to use them.`;
}

export function SplitFacts({ splits }: { splits: Record<string, number> }) {
    return SPLITS.filter(([key]) => key in splits).map(([key, label]) => (
        <Fact key={key} label={label} value={count(splits[key])} />
    ));
}

function DatasetStats({
    dataset,
    stats,
}: {
    dataset: DatasetSummary;
    stats: DatasetVersionStats | undefined;
}) {
    const latest = dataset.dataset_version;
    const quality = stats?.quality;
    const splits = latest?.counts ?? {};
    const notes = [splitsNote(dataset), liveRowsNote(dataset)].filter(Boolean);
    return (
        <AboutPart title="Overview">
            <Facts>
                <Fact label="Rows" value={latest ? count(quality?.rows ?? latest.rows) : "–"} />
                <Fact label="Labels" value={quality ? count(quality.labels) : "–"} />
                <Fact label="Sources" value={count(dataset.sources.length)} />
                <SplitFacts splits={splits} />
            </Facts>
            {notes.map((note) => (
                <p key={note} className="text-sm text-muted-foreground tabular-nums">
                    {note}
                </p>
            ))}
        </AboutPart>
    );
}

export function SavedLabelBalance({
    saved,
    stats,
}: {
    saved: boolean;
    stats: ReturnType<typeof useDatasetVersionStats>;
}) {
    if (!saved) {
        return <p className="text-muted-foreground">No version yet.</p>;
    }
    if (!stats.data) {
        return stats.error ? (
            <ErrorLine error={stats.error} />
        ) : (
            <p className="text-muted-foreground">Loading…</p>
        );
    }
    const { quality, label_counts } = stats.data;
    return (
        <LabelBalance
            counts={label_counts}
            labels={quality.labels}
            rows={quality.rows - quality.empty}
        />
    );
}

type PreviewRow = PreviewResponse["rows"][number];

export const PREVIEW_COLUMNS: ColumnDef<PreviewRow, unknown>[] = [
    { header: "Input", accessorKey: "input", cell: (info) => <Clamp text={info.getValue()} /> },
    {
        header: "Label",
        id: "label",
        accessorFn: (row) => row.label ?? undefined,
        sortingFn: naturalSort(),
        sortUndefined: "last",
        cell: (info) => <span className="font-mono">{String(info.getValue() ?? "–")}</span>,
    },
];

export function rowSummary(record: unknown): ReactNode {
    const row = record as PreviewRow;
    return (
        <>
            <span className="min-w-0 flex-1 truncate">{row.input ?? "–"}</span>
            <span className="max-w-[40%] shrink-0 truncate font-mono text-sm text-syntax-string">
                {row.label ?? "–"}
            </span>
        </>
    );
}

const CHAT_ROLES = new Set(["user", "assistant"]);

export function TrainingExample({ data }: { data: Pick<PreviewResponse, "example"> | undefined }) {
    if (!data || data.example.length === 0) {
        return <p className="px-3 py-2 text-muted-foreground">No example yet.</p>;
    }
    return (
        <div className="flex max-w-2xl flex-col gap-5 p-panel">
            <h3 className="font-semibold">One training example</h3>
            {data.example.map((message, index) => {
                const role = CHAT_ROLES.has(message.role) ? message.role : "system";
                return (
                    <ChatBubble
                        key={`${index}:${message.role}`}
                        variant="plain"
                        role={role as ChatRole}
                        text={role === "assistant" ? asCode(message.content) : message.content}
                    />
                );
            })}
        </div>
    );
}

function DatasetPreview({ dataset }: { dataset: DatasetSummary }) {
    const mapped = Boolean(dataset.mapping.sql);
    const [limit, setLimit] = useState(20);
    const preview = useDatasetPreview(dataset.slug, mapped, limit);
    const empty = mapped
        ? "The query returned no rows."
        : "No query yet. Use Edit query to pick the columns.";
    return (
        <RowsPreview
            records={preview.data?.rows ?? []}
            total={preview.data?.quality.rows}
            loading={preview.isLoading}
            error={preview.error}
            onRetry={preview.refetch}
            marked={["label"]}
            summary={rowSummary}
            empty={empty}
            onMore={
                limit < 500 ? () => setLimit((current) => Math.min(500, current + 100)) : undefined
            }
            loadingMore={preview.isPlaceholderData}
            table={
                <DataGrid
                    columns={PREVIEW_COLUMNS}
                    rows={preview.data?.rows ?? []}
                    loading={preview.isLoading}
                    loadingRows={6}
                    maxHeight="100%"
                    empty={empty}
                />
            }
            example={<TrainingExample data={preview.data} />}
        />
    );
}

export function DatasetDetail({
    dataset,
    sources,
    index,
    onSelect,
}: {
    dataset: DatasetSummary;
    sources: SourceSummary[];
    index: FolderIndex;
    onSelect: (item: ItemRef) => void;
}) {
    const refresh = useDataRefresh();
    const router = useRouter();
    const editQuery = () => router.history.push(datasetEditHref(dataset.slug, "query"));
    const [deleting, setDeleting] = useState(false);
    const [moving, setMoving] = useState<MoveTarget | null>(null);
    const folderId = dataset.folder_id ?? null;
    const mapped = Boolean(dataset.mapping.sql);
    const stats = useDatasetVersionStats(dataset.dataset_version?.id);
    const versions = useDatasetVersions(dataset.slug);
    const save = useSaveVersion(dataset.slug);
    const tooFew = dataset.dataset_version?.too_few_rows ?? null;
    const path = { params: { path: { slug: dataset.slug } } };
    const remove = useMutation({
        mutationFn: () => succeed(api.DELETE("/api/datasets/{slug}", path)),
        onSuccess: async () => {
            onSelect(folderRef(folderId));
            await refresh();
        },
    });
    const header = (
        <ItemHeader
            title={dataset.name}
            described={dataset}
            detail={
                <>
                    {`Updated ${relativeTime(dataset.updated_at)}`}
                    {folderId !== null && (
                        <>
                            {" · in "}
                            <PathLinks index={index} folderId={folderId} />
                        </>
                    )}
                </>
            }
            actions={
                <>
                    <VersionPicker
                        slug={dataset.slug}
                        current={null}
                        versions={versions.data ?? []}
                    />
                    {tooFew ? (
                        <BlockedButton reason={tooFew}>
                            <IconSchool />
                            Train a model
                        </BlockedButton>
                    ) : (
                        <Button asChild>
                            <Link href={`/models/new?dataset=${encodeURIComponent(dataset.slug)}`}>
                                <IconSchool />
                                Train a model
                            </Link>
                        </Button>
                    )}
                    <ItemMenu name={dataset.name}>
                        <DropdownMenuItem
                            onSelect={() => router.history.push(datasetEditHref(dataset.slug))}
                        >
                            <IconPencil />
                            Edit dataset
                        </DropdownMenuItem>
                        <FullVersionItem dataset={dataset} save={save} />
                        <DropdownMenuItem
                            onSelect={() =>
                                setMoving({
                                    item: { kind: "dataset", id: dataset.slug },
                                    name: dataset.name,
                                    from: folderId,
                                })
                            }
                        >
                            <IconFolderDown />
                            Move to…
                        </DropdownMenuItem>
                        <DeleteMenuItem
                            blocked={dataset.delete_lock ?? null}
                            onSelect={() => setDeleting(true)}
                        />
                    </ItemMenu>
                </>
            }
        />
    );
    const about = (
        <>
            <ErrorLine error={remove.error} />
            {dataset.error && (
                <p className="text-destructive">{`The query fails: ${dataset.error}`}</p>
            )}
            <RowLimitNotice dataset={dataset} />
            <FirstVersionNotice dataset={dataset} />
            <ChangeNotice
                changed={dataset.changed}
                datasetVersion={dataset.dataset_version}
                dataset={needsSample(dataset) ? null : dataset.slug}
                after={
                    needsSample(dataset)
                        ? "Take a sample to save the next version."
                        : "Models keep training on it until you update."
                }
            />
            <SampleLine dataset={dataset} save={save} />
            <DatasetStats dataset={dataset} stats={stats.data} />
            <AboutPart
                title="Data quality"
                tip={checksCaption(dataset.dataset_version) || undefined}
            >
                <ChecksList datasetVersion={dataset.dataset_version} dataset={dataset.slug} />
            </AboutPart>
            <QueryPart dataset={dataset} sources={sources} onEdit={editQuery} />
            {mapped && (
                <AboutPart title="Label balance" tip={LABEL_BALANCE_TIP}>
                    <SavedLabelBalance saved={Boolean(dataset.dataset_version)} stats={stats} />
                </AboutPart>
            )}
            <UsedBy dataset={dataset} versions={versions.data ?? []} />
        </>
    );
    return (
        <>
            <SplitDetail
                header={header}
                about={about}
                preview={<DatasetPreview dataset={dataset} />}
            />
            <MoveDialog
                targets={moving ? [moving] : null}
                index={index}
                onOpenChange={(open) => !open && setMoving(null)}
            />
            <ConfirmDialog
                open={deleting}
                onOpenChange={setDeleting}
                title={`Delete ${dataset.name}?`}
                description={datasetDeleteNote(dataset.model_names ?? [])}
                confirmLabel="Delete"
                destructive
                onConfirm={() => remove.mutateAsync().catch(() => undefined)}
            />
        </>
    );
}
