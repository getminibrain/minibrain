import { IconPencil, IconTags } from "@tabler/icons-react";
import { useMutation } from "@tanstack/react-query";
import {
    Button,
    ConfirmDialog,
    DataGrid,
    DropdownMenuItem,
    FileName,
    Link,
    Tooltip,
    TooltipContent,
    TooltipTrigger,
} from "obp-ui";
import { useMemo, useState } from "react";
import {
    type ColumnStats,
    type DatasetSummary,
    type SourceSummary,
    api,
    succeed,
    unwrap,
} from "~/api/client";
import { useSourceRows, useSourceStats } from "~/api/queries";
import { ErrorLine, Stat } from "~/components/Section";
import { count } from "~/lib/format";
import { fileSize, relativeTime } from "~/lib/time";
import { ConnectedFacts } from "./Connected";
import { CreateDatasetDialog } from "./DatasetDetail";
import { FORMAT_LABELS } from "./Folders";
import { LakehouseFacts } from "./Lakehouse";
import { RowsPreview } from "./RowsPreview";
import {
    type ItemRef,
    groupOf,
    itemHref,
    plural,
    sourceNameProblem,
    tableFormat,
} from "./catalogue";
import { isTextType, rowRecord, typeWord } from "./columnTypes";
import { SourceIcon } from "./icons";
import {
    AboutPart,
    DeleteMenuItem,
    EditDialog,
    type EditFocus,
    ItemHeader,
    ItemMenu,
    SplitDetail,
    Stats,
    useDataRefresh,
} from "./parts";
import { resultColumns } from "./resultColumns";

const ENCODING_LABELS: Record<string, string> = {
    "utf-8": "UTF-8",
    "windows-1252": "Windows-1252",
    "utf-16le": "UTF-16 LE",
    "utf-16be": "UTF-16 BE",
};

function share(part: number, whole: number): string {
    if (whole === 0) {
        return "–";
    }
    const value = (part / whole) * 100;
    return part > 0 && value < 1 ? "<1%" : `${Math.round(value)}%`;
}

function rangeText(stats: ColumnStats | undefined): string | null {
    if (!stats || stats.min === null || isTextType(stats.type)) {
        return null;
    }
    return stats.min === stats.max ? stats.min : `${stats.min} … ${stats.max}`;
}

function SchemaRow({
    name,
    type,
    stats,
    sampled,
}: {
    name: string;
    type: string;
    stats: ColumnStats | undefined;
    sampled: number;
}) {
    const range = rangeText(stats);
    return (
        <tr className="h-8 border-t first:border-t-0">
            <th scope="row" className="pr-3 text-left font-normal">
                <Tooltip>
                    <TooltipTrigger asChild>
                        <span className="block truncate font-mono">{name}</span>
                    </TooltipTrigger>
                    <TooltipContent className="max-w-96 break-all">{name}</TooltipContent>
                </Tooltip>
            </th>
            <td className="pr-3">
                <Tooltip>
                    <TooltipTrigger asChild>
                        <span className="block truncate text-muted-foreground">
                            {typeWord(type)}
                        </span>
                    </TooltipTrigger>
                    <TooltipContent className="max-w-96 break-all">
                        <span className="font-mono">{type}</span>
                        {range && ` · ${range}`}
                    </TooltipContent>
                </Tooltip>
            </td>
            <td className="pr-3 text-right tabular-nums">
                {stats ? share(stats.nulls, sampled) : "–"}
            </td>
            <td className="text-right tabular-nums">{stats ? count(stats.distinct) : "–"}</td>
        </tr>
    );
}

function Schema({ source }: { source: SourceSummary }) {
    const stats = useSourceStats(source.id);
    const byName = new Map((stats.data?.columns ?? []).map((column) => [column.name, column]));
    const sampled = stats.data?.sampled ?? 0;
    const caption =
        stats.data && stats.data.sampled < stats.data.rows
            ? `Empty and distinct from the first ${count(sampled)} rows; distinct is an estimate.`
            : "Empty and distinct over every row; distinct is an estimate.";
    return (
        <AboutPart title="Schema">
            <ErrorLine error={stats.error} onRetry={stats.refetch} />
            <table className="w-full table-fixed border-collapse">
                <caption className="sr-only">Columns of the source</caption>
                <thead>
                    <tr className="h-8 border-b text-sm text-muted-foreground">
                        <th scope="col" className="pr-3 text-left font-normal">
                            Column
                        </th>
                        <th
                            scope="col"
                            className="w-20 pr-3 @min-[54rem]/detail:w-28 text-left font-normal"
                        >
                            Type
                        </th>
                        <th scope="col" className="w-14 pr-3 text-right font-normal">
                            Empty
                        </th>
                        <th
                            scope="col"
                            className="w-14 text-right @min-[54rem]/detail:w-16 font-normal"
                        >
                            Distinct
                        </th>
                    </tr>
                </thead>
                <tbody>
                    {source.columns.map((column) => (
                        <SchemaRow
                            key={column.name}
                            name={column.name}
                            type={column.type}
                            stats={byName.get(column.name)}
                            sampled={sampled}
                        />
                    ))}
                </tbody>
            </table>
            <p className="text-sm text-muted-foreground">{caption}</p>
        </AboutPart>
    );
}

function SourcePreview({ source }: { source: SourceSummary }) {
    const [limit, setLimit] = useState(50);
    const rows = useSourceRows(source.id, limit);
    const records = useMemo(() => {
        if (!rows.data) {
            return [];
        }
        const types = new Map(source.columns.map((column) => [column.name, column.type]));
        const { columns } = rows.data;
        return rows.data.rows.map((row) => rowRecord(columns, row, types));
    }, [rows.data, source.columns]);
    return (
        <RowsPreview
            records={records}
            total={source.rows}
            loading={rows.isLoading}
            error={rows.error}
            onRetry={rows.refetch}
            empty="The source has no rows."
            onMore={
                limit < 500 ? () => setLimit((current) => Math.min(500, current + 100)) : undefined
            }
            loadingMore={rows.isPlaceholderData}
            table={
                <DataGrid
                    columns={rows.data ? resultColumns(rows.data) : []}
                    rows={rows.data?.rows ?? []}
                    loading={rows.isLoading}
                    maxHeight="100%"
                    minWidth={
                        rows.data && rows.data.columns.length > 4 ? "min-w-[960px]" : undefined
                    }
                    empty="The source has no rows."
                />
            }
        />
    );
}

function Datasets({ datasets }: { datasets: DatasetSummary[] }) {
    return (
        <AboutPart title="Used by datasets">
            {datasets.length === 0 ? (
                <p className="text-muted-foreground">No dataset reads it yet.</p>
            ) : (
                <ul className="flex flex-col divide-y rounded-lg border">
                    {datasets.map((dataset) => (
                        <li key={dataset.slug} className="flex h-8 items-center gap-3 px-3">
                            <Link
                                href={itemHref({ kind: "dataset", id: dataset.slug })}
                                className="min-w-0 truncate text-primary"
                            >
                                {dataset.name}
                            </Link>
                            <span className="ml-auto shrink-0 text-sm text-muted-foreground tabular-nums">
                                {dataset.rows === null ? "–" : plural(dataset.rows, "row")}
                            </span>
                        </li>
                    ))}
                </ul>
            )}
        </AboutPart>
    );
}

function SourceStats({ source, datasets }: { source: SourceSummary; datasets: number }) {
    const lastChange = source.modified_at ? relativeTime(source.modified_at) : "–";
    return (
        <Stats>
            <Stat label="Rows" value={count(source.rows)} />
            <Stat label="Columns" value={count(source.columns.length)} />
            {(source.kind === "upload" || source.kind === "folder" || source.kind === "s3") && (
                <Stat label="Size" value={fileSize(source.size)} />
            )}
            <Stat label="Datasets" value={count(datasets)} />
            {(source.kind === "folder" || source.kind === "s3") && (
                <Stat
                    label={source.kind === "s3" ? "Objects" : "Files"}
                    value={`${count(source.files)} ${FORMAT_LABELS[source.format ?? ""] ?? ""}`}
                />
            )}
            {(source.kind === "folder" || source.kind === "s3" || tableFormat(source.kind)) && (
                <Stat label="Last change" value={lastChange} />
            )}
            {source.encoding && (
                <Stat
                    label="Encoding"
                    value={ENCODING_LABELS[source.encoding] ?? source.encoding}
                />
            )}
        </Stats>
    );
}

export function FileDetail({
    source,
    sources,
    datasets,
    creating,
    onCreating,
    onSelect,
}: {
    source: SourceSummary;
    sources: SourceSummary[];
    datasets: DatasetSummary[];
    creating: boolean;
    onCreating: (creating: boolean) => void;
    onSelect: (item: ItemRef) => void;
}) {
    const refresh = useDataRefresh();
    const [editing, setEditing] = useState<EditFocus | null>(null);
    const [deleting, setDeleting] = useState(false);
    const path = { params: { path: { source_id: source.id } } };
    const remove = useMutation({
        mutationFn: () => succeed(api.DELETE("/api/sources/{source_id}", path)),
        onSuccess: async () => {
            onSelect({ kind: "group", id: groupOf(source.kind).id });
            await refresh();
        },
    });
    const format = tableFormat(source.kind);
    const header = (
        <ItemHeader
            title={source.kind === "upload" ? <FileName name={source.name} /> : source.name}
            described={source}
            icon={source.kind === "upload" || format ? <SourceIcon source={source} /> : undefined}
            detail={`Added ${relativeTime(source.created_at)}`}
            actions={
                <>
                    <Button onClick={() => onCreating(true)} disabled={creating}>
                        Create dataset
                    </Button>
                    <ItemMenu name={source.name}>
                        <DropdownMenuItem onSelect={() => setEditing("name")}>
                            <IconPencil />
                            Rename
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => setEditing("description")}>
                            <IconTags />
                            Edit description and tags
                        </DropdownMenuItem>
                        <DeleteMenuItem
                            blocked={
                                datasets.length
                                    ? `Used by ${plural(datasets.length, "dataset")}: delete those first.`
                                    : null
                            }
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
            {source.error && <p className="text-destructive">{source.error}</p>}
            <SourceStats source={source} datasets={datasets.length} />
            <ConnectedFacts source={source} />
            <LakehouseFacts source={source} />
            <Schema source={source} />
            <Datasets datasets={datasets} />
        </>
    );
    return (
        <>
            <SplitDetail
                header={header}
                about={about}
                preview={<SourcePreview source={source} />}
            />
            <CreateDatasetDialog
                open={creating}
                source={source}
                sources={sources}
                onOpenChange={onCreating}
                onCreated={async (dataset) => {
                    await refresh();
                    onCreating(false);
                    onSelect({ kind: "dataset", id: dataset.slug });
                }}
            />
            <EditDialog
                item={source}
                noun={source.kind === "upload" ? "file" : "source"}
                problem={(name) => sourceNameProblem(sources, name, source.id)}
                focus={editing}
                onFocusChange={setEditing}
                onSave={(body) =>
                    unwrap(api.PATCH("/api/sources/{source_id}", { ...path, body })).then(refresh)
                }
            />
            <ConfirmDialog
                open={deleting}
                onOpenChange={setDeleting}
                title={`Delete ${source.name}?`}
                description={
                    source.kind === "upload"
                        ? "The stored copy and its staged table go. This cannot be undone."
                        : "minibrain stops reading it; the data stays where it is."
                }
                confirmLabel="Delete"
                destructive
                onConfirm={() => remove.mutateAsync().catch(() => undefined)}
            />
        </>
    );
}
