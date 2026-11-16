import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
    Button,
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DropZone,
} from "obp-ui";
import { type DatasetSummary, type SourceAdded, api, unwrap } from "~/api/client";
import { keys } from "~/api/queries";
import { ErrorLine } from "~/components/Section";
import { DATA_FILE_TYPES } from "~/lib/dataFiles";
import { useSourceAdder } from "../data/AddSource";
import { SampleOffer, type SampleRequest, useOverLimit } from "../data/SampleOffer";

function withoutExtension(name: string): string {
    return name.replace(/\.[A-Za-z0-9]+$/, "") || name;
}

function freeName(name: string, datasets: DatasetSummary[]): string {
    const taken = new Set(
        datasets
            .filter((dataset) => dataset.folder_id === null || dataset.folder_id === undefined)
            .map((dataset) => dataset.name.toLowerCase()),
    );
    if (!taken.has(name.toLowerCase())) {
        return name;
    }
    let index = 2;
    while (taken.has(`${name} ${index}`.toLowerCase())) {
        index += 1;
    }
    return `${name} ${index}`;
}

export function useDatasetMaker(datasets: DatasetSummary[], onMade: (slug: string) => void) {
    const client = useQueryClient();
    const create = useMutation({
        mutationFn: async ({
            source,
            name,
            sample,
        }: { source: SourceAdded; name?: string; sample?: SampleRequest }) => {
            const reused = source.datasets[0];
            if (reused) {
                return reused;
            }
            const made = await unwrap(
                api.POST("/api/datasets", {
                    body: {
                        name: freeName(name ?? withoutExtension(source.name), datasets),
                        source_id: source.id,
                        sample: sample ?? null,
                    },
                }),
            );
            return made.slug;
        },
        onSuccess: async (slug) => {
            await client.invalidateQueries({ queryKey: keys.datasets, exact: true });
            onMade(slug);
        },
    });
    return create;
}

export function UploadDatasetDialog({
    open,
    datasets,
    onOpenChange,
    onCreated,
}: {
    open: boolean;
    datasets: DatasetSummary[];
    onOpenChange: (open: boolean) => void;
    onCreated: (slug: string) => void;
}) {
    const create = useDatasetMaker(datasets, (slug) => {
        onCreated(slug);
        onOpenChange(false);
    });
    const adder = useSourceAdder((source) => create.mutate({ source }));
    const busy = adder.pending !== null || create.isPending;
    const over = useOverLimit(create.error, create.isPending && Boolean(create.variables?.sample));
    const status =
        adder.pending === "upload" ? "Uploading…" : create.isPending ? "Making the dataset…" : null;
    const close = (next: boolean) => {
        if (!next && busy) {
            return;
        }
        if (!next) {
            create.reset();
        }
        onOpenChange(next);
    };
    return (
        <Dialog open={open} onOpenChange={close}>
            <DialogContent className="sm:max-w-lg">
                <DialogHeader>
                    <DialogTitle>Upload a dataset</DialogTitle>
                    <DialogDescription>
                        A CSV, TSV, JSON, JSON Lines or Parquet file with a question and an answer
                        per row. It becomes a dataset with held-out rows set aside, picked for this
                        model.
                    </DialogDescription>
                </DialogHeader>
                <DropZone
                    accept={DATA_FILE_TYPES}
                    disabled={busy}
                    onFiles={adder.drop}
                    title={status ?? "Drop a file here"}
                    description={status ? undefined : "or choose one from this computer"}
                />
                {over && create.variables ? (
                    <SampleOffer
                        subject="file"
                        total={over.total_rows}
                        limit={over.row_limit}
                        pending={create.isPending}
                        onTake={(sample) =>
                            create.variables && create.mutate({ ...create.variables, sample })
                        }
                    />
                ) : (
                    <ErrorLine error={adder.error ?? create.error} />
                )}
                {adder.picker}
                <DialogFooter>
                    <Button variant="outline" disabled={busy} onClick={() => close(false)}>
                        Cancel
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
