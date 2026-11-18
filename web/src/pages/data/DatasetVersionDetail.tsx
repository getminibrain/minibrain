import { IconChevronDown, IconGitCompare } from "@tabler/icons-react";
import {
    Button,
    CodeBlock,
    DataGrid,
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
    Link,
} from "obp-ui";
import { useState } from "react";
import type { DatasetSummary } from "~/api/client";
import {
    type DatasetVersionInfo,
    useDatasetVersionRows,
    useDatasetVersionStats,
    useDatasetVersions,
} from "~/api/dataQueries";
import { useAllModels } from "~/api/queries";
import { BlockedButton } from "~/components/BlockedButton";
import { NotFoundState } from "~/components/ErrorState";
import { PublisherLogo } from "~/components/PublisherLogo";
import { ErrorLine } from "~/components/Section";
import { count } from "~/lib/format";
import { modelVersionHref, trainHref } from "~/lib/modelLinks";
import { relativeTime } from "~/lib/time";
import { ChecksList, checksCaption } from "./Checks";
import {
    LABEL_BALANCE_TIP,
    PREVIEW_COLUMNS,
    SavedLabelBalance,
    SplitFacts,
    TrainingExample,
    rowSummary,
} from "./DatasetDetail";
import { PathLinks } from "./DatasetFolders";
import { VersionPicker, takenAt, useCompareParam } from "./DatasetVersions";
import { RowsPreview } from "./RowsPreview";
import { sampleText } from "./SampleOffer";
import { type FolderIndex, datasetHref } from "./catalogue";
import {
    AboutPart,
    Fact,
    Facts,
    ItemHeader,
    ItemMenu,
    SplitDetail,
    modelHref,
    useModelNames,
} from "./parts";

const MAX_ROWS = 500;

function newModelHref(slug: string, datasetVersion: DatasetVersionInfo): string {
    const search = new URLSearchParams({ dataset: slug, data: String(datasetVersion.id) });
    return `/models/new?${search.toString()}`;
}

function TrainFrom({
    dataset,
    datasetVersion,
}: {
    dataset: DatasetSummary;
    datasetVersion: DatasetVersionInfo;
}) {
    const nameOf = useModelNames();
    const label = `Train from v${datasetVersion.number}`;
    if (datasetVersion.too_few_rows) {
        return <BlockedButton reason={datasetVersion.too_few_rows}>{label}</BlockedButton>;
    }
    const fresh = newModelHref(dataset.slug, datasetVersion);
    if (dataset.models.length === 0) {
        return (
            <Button asChild>
                <Link href={fresh}>{label}</Link>
            </Button>
        );
    }
    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button>
                    {label}
                    <IconChevronDown aria-hidden="true" />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64">
                {dataset.models.map((slug) => (
                    <DropdownMenuItem key={slug} asChild>
                        <Link href={trainHref(slug, { data: datasetVersion.id })}>
                            <span className="truncate">{nameOf(slug)}</span>
                        </Link>
                    </DropdownMenuItem>
                ))}
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                    <Link href={fresh}>New model…</Link>
                </DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>
    );
}

function VersionStats({
    datasetVersion,
    stats,
}: {
    datasetVersion: DatasetVersionInfo;
    stats: ReturnType<typeof useDatasetVersionStats>;
}) {
    const quality = stats.data?.quality;
    const notes = [
        datasetVersion.sample ? sampleText(datasetVersion.sample) : null,
        datasetVersion.too_few_rows ?? null,
    ].filter((note): note is string => Boolean(note));
    return (
        <AboutPart title="Overview">
            <Facts>
                <Fact label="Rows" value={count(quality?.rows ?? datasetVersion.rows)} />
                <Fact
                    label="Labels"
                    value={count(quality?.labels ?? datasetVersion.labels.length)}
                />
                <Fact label="Sources" value={count(datasetVersion.sources ?? 0)} />
                <SplitFacts splits={datasetVersion.counts} />
            </Facts>
            {notes.map((note) => (
                <p key={note} className="text-sm text-muted-foreground tabular-nums">
                    {note}
                </p>
            ))}
        </AboutPart>
    );
}

function SavedQuery({ sql }: { sql: string | null | undefined }) {
    return (
        <AboutPart title="Query" tip="The query this version was saved with.">
            {sql ? (
                <CodeBlock
                    code={sql}
                    language="sql"
                    copyLabel="Copy the query"
                    wrap
                    className="max-h-56"
                />
            ) : (
                <p className="text-muted-foreground">This version does not keep its query.</p>
            )}
        </AboutPart>
    );
}

function trainedBy(datasetVersion: DatasetVersionInfo): [string, number[]][] {
    const found = new Map<string, number[]>();
    for (const tag of datasetVersion.versions) {
        const [slug, number] = tag.split("@");
        found.set(slug, [...(found.get(slug) ?? []), Number(number)]);
    }
    return [...found.entries()].map(([slug, numbers]) => [slug, numbers.sort((a, b) => a - b)]);
}

function VersionUsedBy({ datasetVersion }: { datasetVersion: DatasetVersionInfo }) {
    const nameOf = useModelNames();
    const models = useAllModels();
    const avatarOf = (slug: string) =>
        (models.data ?? []).find((row) => row.key === slug)?.avatar ?? null;
    const used = trainedBy(datasetVersion);
    return (
        <AboutPart title="Used by" tip="Model versions that trained or scored on this version.">
            {used.length === 0 ? (
                <p className="text-muted-foreground">No model version uses it.</p>
            ) : (
                <ul className="flex flex-col">
                    {used.map(([slug, numbers]) => (
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
                            <span className="flex shrink-0 gap-2 tabular-nums">
                                {numbers.map((number) => (
                                    <Link
                                        key={number}
                                        href={modelVersionHref(slug, number)}
                                        className="text-primary hover:underline"
                                    >
                                        {`v${number}`}
                                    </Link>
                                ))}
                            </span>
                        </li>
                    ))}
                </ul>
            )}
        </AboutPart>
    );
}

function VersionPreview({ datasetVersion }: { datasetVersion: DatasetVersionInfo }) {
    const [limit, setLimit] = useState(20);
    const rows = useDatasetVersionRows(datasetVersion.id, limit);
    const records = rows.data?.rows ?? [];
    const empty = "This version holds no rows.";
    return (
        <RowsPreview
            records={records}
            total={rows.data?.total}
            loading={rows.isLoading}
            error={rows.error}
            onRetry={rows.refetch}
            marked={["label"]}
            summary={rowSummary}
            empty={empty}
            onMore={
                limit < MAX_ROWS
                    ? () => setLimit((current) => Math.min(MAX_ROWS, current + 100))
                    : undefined
            }
            loadingMore={rows.isPlaceholderData}
            table={
                <DataGrid
                    columns={PREVIEW_COLUMNS}
                    rows={records}
                    loading={rows.isLoading}
                    loadingRows={6}
                    maxHeight="100%"
                    empty={empty}
                />
            }
            example={<TrainingExample data={rows.data} />}
        />
    );
}

function ViewingNotice({ number, latest, slug }: { number: number; latest: number; slug: string }) {
    return (
        <p className="text-muted-foreground tabular-nums">
            {`Viewing v${number} of ${latest} · `}
            <Link href={datasetHref(slug)} className="text-primary hover:underline">
                Go to latest
            </Link>
        </p>
    );
}

function SavedVersion({
    dataset,
    datasetVersion,
    versions,
    index,
}: {
    dataset: DatasetSummary;
    datasetVersion: DatasetVersionInfo;
    versions: DatasetVersionInfo[];
    index: FolderIndex;
}) {
    const stats = useDatasetVersionStats(datasetVersion.id);
    const compare = useCompareParam();
    const latest = versions[0];
    const number = datasetVersion.number ?? 0;
    const isLatest = latest?.id === datasetVersion.id;
    const folderId = dataset.folder_id ?? null;
    const header = (
        <ItemHeader
            title={dataset.name}
            described={dataset}
            detail={
                <>
                    {`v${number} saved ${relativeTime(takenAt(datasetVersion))}`}
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
                    <VersionPicker slug={dataset.slug} current={number} versions={versions} />
                    <TrainFrom dataset={dataset} datasetVersion={datasetVersion} />
                    <ItemMenu name={`${dataset.name} v${number}`}>
                        <DropdownMenuItem
                            disabled={isLatest || !latest}
                            onSelect={() => latest && compare.set([datasetVersion.id, latest.id])}
                        >
                            <IconGitCompare />
                            Compare with latest
                        </DropdownMenuItem>
                    </ItemMenu>
                </>
            }
        />
    );
    const about = (
        <>
            <ViewingNotice number={number} latest={latest?.number ?? number} slug={dataset.slug} />
            <VersionStats datasetVersion={datasetVersion} stats={stats} />
            <SavedQuery sql={datasetVersion.sql} />
            <AboutPart title="Data quality" tip={checksCaption(datasetVersion) || undefined}>
                <ChecksList datasetVersion={datasetVersion} dataset={dataset.slug} readOnly />
            </AboutPart>
            <AboutPart title="Label balance" tip={LABEL_BALANCE_TIP}>
                <SavedLabelBalance saved stats={stats} />
            </AboutPart>
            <VersionUsedBy datasetVersion={datasetVersion} />
        </>
    );
    return (
        <SplitDetail
            header={header}
            about={about}
            preview={<VersionPreview datasetVersion={datasetVersion} />}
        />
    );
}

export function DatasetVersionDetail({
    dataset,
    number,
    index,
}: {
    dataset: DatasetSummary;
    number: number;
    index: FolderIndex;
}) {
    const versions = useDatasetVersions(dataset.slug);
    const rows = versions.data ?? [];
    const found = rows.find((item) => item.number === number);
    if (versions.isLoading) {
        return <p className="p-6 text-muted-foreground">Loading…</p>;
    }
    if (versions.error) {
        return (
            <div className="p-6">
                <ErrorLine error={versions.error} onRetry={versions.refetch} />
            </div>
        );
    }
    if (!found) {
        return (
            <NotFoundState
                heading="h2"
                title="Version not found"
                primary={{ label: "Go to latest", href: datasetHref(dataset.slug) }}
            >
                {`${dataset.name} has no version ${number}. It may never have been saved.`}
            </NotFoundState>
        );
    }
    return <SavedVersion dataset={dataset} datasetVersion={found} versions={rows} index={index} />;
}
