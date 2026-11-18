import { IconTrash, IconX } from "@tabler/icons-react";
import { useMutation } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import {
    Button,
    Checkbox,
    DataGrid,
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    Label,
    Link,
} from "obp-ui";
import { useEffect, useState } from "react";
import { type SourceSummary, api, succeed } from "~/api/client";
import { useDatasets } from "~/api/queries";
import { ErrorLine } from "~/components/Section";
import { When } from "~/components/When";
import { StatusText } from "~/components/models/StatusText";
import { count } from "~/lib/format";
import { fileSize } from "~/lib/time";
import { type ItemRef, itemHref, plural, sourceRef } from "./catalogue";
import { SourceIcon } from "./icons";
import { FILL, FILL_GRID, useDataRefresh } from "./parts";

const COLUMNS: ColumnDef<SourceSummary, unknown>[] = [
    {
        id: "name",
        header: "Name",
        accessorFn: (source) => source.name.toLowerCase(),
        cell: ({ row }) => (
            <span className="flex min-w-0 items-center gap-2">
                <SourceIcon source={row.original} className="size-4 shrink-0" />
                <Link href={itemHref(sourceRef(row.original))} className="truncate">
                    {row.original.name}
                </Link>
            </span>
        ),
    },
    {
        id: "table",
        header: "Table in SQL",
        accessorKey: "table",
        cell: ({ row }) => <span className="font-mono">{row.original.table}</span>,
    },
    {
        id: "rows",
        header: "Rows",
        accessorFn: (source) => source.rows ?? -1,
        cell: ({ row }) => (
            <span className="tabular-nums">
                {row.original.rows === null ? "–" : count(row.original.rows)}
            </span>
        ),
    },
    {
        id: "size",
        header: "Size",
        accessorKey: "size",
        cell: ({ row }) => (
            <span className="tabular-nums">
                {row.original.size ? fileSize(row.original.size) : "–"}
            </span>
        ),
    },
    {
        id: "datasets",
        header: "Datasets",
        accessorFn: (source) => source.datasets.length,
        cell: ({ row }) => (
            <span className="tabular-nums">{count(row.original.datasets.length)}</span>
        ),
    },
    {
        id: "added",
        header: "Added",
        accessorFn: (source) => Date.parse(source.created_at),
        cell: ({ row }) => <When value={row.original.created_at} />,
    },
];

function DeleteSourcesDialog({
    sources,
    onOpenChange,
    onDeleted,
}: {
    sources: SourceSummary[] | null;
    onOpenChange: (open: boolean) => void;
    onDeleted: () => void;
}) {
    const refresh = useDataRefresh();
    const datasets = useDatasets();
    const [cascade, setCascade] = useState(false);
    const opened = sources ? sources.map((source) => source.id).join(",") : null;
    useEffect(() => {
        if (opened !== null) {
            setCascade(false);
        }
    }, [opened]);
    const chosen = sources ?? [];
    const readers = [...new Set(chosen.flatMap((source) => source.datasets))];
    const nameOf = (slug: string) =>
        datasets.data?.find((dataset) => dataset.slug === slug)?.name ?? slug;
    const deletable = cascade ? chosen : chosen.filter((source) => source.datasets.length === 0);
    const remove = useMutation({
        mutationFn: async () => {
            if (cascade) {
                for (const slug of readers) {
                    await succeed(
                        api.DELETE("/api/datasets/{slug}", { params: { path: { slug } } }),
                    );
                }
            }
            for (const source of deletable) {
                await succeed(
                    api.DELETE("/api/sources/{source_id}", {
                        params: { path: { source_id: source.id } },
                    }),
                );
            }
        },
        onSuccess: () => {
            onDeleted();
            onOpenChange(false);
        },
        onSettled: refresh,
    });
    const what = [
        plural(deletable.length, "source"),
        cascade && readers.length > 0 ? plural(readers.length, "dataset") : "",
    ]
        .filter(Boolean)
        .join(" and ");
    return (
        <Dialog open={sources !== null} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-lg">
                <DialogHeader>
                    <DialogTitle>{`Delete ${plural(chosen.length, "source")}?`}</DialogTitle>
                    <DialogDescription>
                        Uploaded files are removed from storage; folders, buckets and tables outside
                        minibrain are left as they are. This cannot be undone.
                    </DialogDescription>
                </DialogHeader>
                <ul className="flex max-h-56 flex-col divide-y overflow-y-auto rounded-lg border">
                    {chosen.map((source) => (
                        <li key={source.id} className="flex items-center gap-3 px-3 py-2.5">
                            <span
                                aria-hidden="true"
                                className="flex size-8 shrink-0 items-center justify-center rounded-md border bg-background"
                            >
                                <SourceIcon source={source} className="size-4" />
                            </span>
                            <span className="flex min-w-0 flex-1 flex-col">
                                <span className="truncate font-medium">{source.name}</span>
                                <span className="truncate text-sm text-muted-foreground">
                                    {source.datasets.length > 0
                                        ? `Read by ${source.datasets.map(nameOf).join(", ")}`
                                        : fileSize(source.size)}
                                </span>
                            </span>
                            {source.datasets.length > 0 && !cascade && (
                                <StatusText tone="warning">In use</StatusText>
                            )}
                        </li>
                    ))}
                </ul>
                {readers.length > 0 && (
                    <div className="flex flex-col gap-3 rounded-lg border p-3">
                        <Label className="flex items-start gap-2 font-normal">
                            <Checkbox
                                checked={cascade}
                                onCheckedChange={(value) => setCascade(value === true)}
                                className="mt-0.5"
                            />
                            <span className="flex flex-col gap-0.5">
                                <span className="font-medium">
                                    {`Also delete the ${plural(readers.length, "dataset")} that ${readers.length === 1 ? "reads" : "read"} them`}
                                </span>
                                <span className="text-sm text-muted-foreground">
                                    A source can't go while a dataset reads it. Models trained on
                                    those datasets keep their versions.
                                </span>
                            </span>
                        </Label>
                        <ul className="flex flex-col divide-y rounded-md border">
                            {readers.map((slug) => (
                                <li key={slug} className="truncate px-3 py-2">
                                    {nameOf(slug)}
                                </li>
                            ))}
                        </ul>
                    </div>
                )}
                <ErrorLine error={remove.error} />
                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)}>
                        Cancel
                    </Button>
                    <Button
                        variant="destructive"
                        disabled={deletable.length === 0 || remove.isPending}
                        onClick={() => remove.mutate()}
                    >
                        {remove.isPending
                            ? "Deleting…"
                            : deletable.length === 0
                              ? "Delete"
                              : `Delete ${what}`}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

export function SourceTable({
    sources,
    selected,
    onSelectedChange,
    onMake,
    onSelect,
}: {
    sources: SourceSummary[];
    selected: string[];
    onSelectedChange: (ids: string[]) => void;
    onMake: (sources: SourceSummary[]) => void;
    onSelect: (item: ItemRef) => void;
}) {
    const [deleting, setDeleting] = useState<SourceSummary[] | null>(null);
    const chosen = sources.filter((source) => selected.includes(String(source.id)));
    const clear = () => onSelectedChange([]);
    return (
        <div className={`${FILL} gap-3`}>
            {chosen.length > 0 && (
                <div className="flex min-h-8 flex-wrap items-center gap-2">
                    <span className="font-medium tabular-nums">{`${chosen.length} selected`}</span>
                    <Button variant="outline" size="sm" onClick={clear}>
                        <IconX />
                        Clear selection
                    </Button>
                    <div className="ml-auto flex flex-wrap items-center gap-2">
                        <Button size="sm" onClick={() => onMake(chosen)}>
                            Make a dataset
                        </Button>
                        <Button variant="destructive" size="sm" onClick={() => setDeleting(chosen)}>
                            <IconTrash />
                            Delete
                        </Button>
                    </div>
                </div>
            )}
            <DataGrid
                columns={COLUMNS}
                rows={sources}
                getRowId={(row) => String(row.id)}
                onOpen={(row) => onSelect(sourceRef(row))}
                rowLabel={(row) => row.name}
                selectedIds={selected}
                onSelectedIdsChange={onSelectedChange}
                maxHeight="100%"
                className={FILL_GRID}
            />
            <DeleteSourcesDialog
                sources={deleting}
                onOpenChange={(open) => !open && setDeleting(null)}
                onDeleted={clear}
            />
        </div>
    );
}
