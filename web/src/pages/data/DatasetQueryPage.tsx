import { useMutation } from "@tanstack/react-query";
import { useBlocker, useRouter } from "@tanstack/react-router";
import { Button, ConfirmDialog, Input } from "obp-ui";
import { type ReactNode, useRef, useState } from "react";
import { type DatasetSummary, type SourceSummary, api, unwrap } from "~/api/client";
import { FORM_ROW_GAP, FormControl, FormRow, FormRows } from "~/components/FormRows";
import { ErrorLine } from "~/components/Section";
import { sqlProblem } from "~/lib/sqlError";
import { useDatasetRefresh } from "./DatasetDetail";
import {
    type Draft,
    type MappingBody,
    QueryEditor,
    draftBody,
    draftSql,
    pickedDraft,
    sameDraft,
    savedDraft,
} from "./QueryEditor";
import { QueryPreviewPanel, shapeSummary, useLivePreview, useSettled } from "./QueryPreview";
import { SampleOffer, useOverLimit } from "./SampleOffer";
import {
    DATASETS_GROUP,
    type FolderIndex,
    type ItemRef,
    datasetHref,
    datasetNameProblem,
    datasetsIn,
    folderPath,
    freeDatasetName,
    itemHref,
    sourceRef,
    stem,
} from "./catalogue";
import { ItemHeader, SplitDetail, type SplitSide, useDataRefresh } from "./parts";
import { defaultName, guessPair, sharedColumns, stackedSql, unionSql } from "./sql";

const EDITOR_SIDE: SplitSide = {
    label: "Query",
    sizing: { key: "minibrain.data.queryWidth", initial: null, min: 420, max: 1100 },
    widths: "@3xl/data:w-80 @min-[52rem]/detail:w-[26rem] @min-[80rem]/detail:w-1/2",
    className: FORM_ROW_GAP,
};

const EMPTY_DRAFT: Draft = { mode: "columns", source: "", input: "", label: "", sql: "" };

function useLeaveGuard(dirty: boolean) {
    const leaving = useRef(false);
    const blocks = () => dirty && !leaving.current;
    const blocker = useBlocker({
        shouldBlockFn: blocks,
        enableBeforeUnload: blocks,
        withResolver: true,
    });
    const dialog = (
        <ConfirmDialog
            open={blocker.status === "blocked"}
            onOpenChange={(open) => {
                if (!open) {
                    blocker.reset?.();
                }
            }}
            title="Leave without saving?"
            description="The query you changed here is not saved."
            confirmLabel="Leave"
            destructive
            onConfirm={() => blocker.proceed?.()}
        />
    );
    return {
        dialog,
        release: () => {
            leaving.current = true;
        },
    };
}

function QueryWorkbench({
    title,
    detail,
    dataset,
    initial,
    sources,
    saveLabel,
    saveBlocked = false,
    edited = false,
    before,
    backHref,
    onSave,
}: {
    title: string;
    detail: ReactNode;
    dataset: string | null;
    initial: Draft;
    sources: SourceSummary[];
    saveLabel: string;
    saveBlocked?: boolean;
    edited?: boolean;
    before?: ReactNode;
    backHref: string;
    onSave: (body: MappingBody) => Promise<string>;
}) {
    const router = useRouter();
    const [draft, setDraft] = useState(initial);
    const live = draftSql(draft, sources);
    const { settled, runNow } = useSettled(live, draft.mode === "columns");
    const preview = useLivePreview(settled, dataset);
    const guard = useLeaveGuard(edited || !sameDraft(draft, initial));
    const save = useMutation({
        mutationFn: onSave,
        onSuccess: (slug) => {
            guard.release();
            router.history.push(datasetHref(slug));
        },
    });
    const over = useOverLimit(save.error, save.isPending && Boolean(save.variables?.sample));
    const body = draftBody(draft, sources);
    const current = live !== null && live === settled;
    const numbers = current ? shapeSummary(preview.counted) : null;
    const missing = current && preview.missing.length > 0;
    const runProblem = sqlProblem(preview.error, preview.sql ?? undefined, draft.sql);
    const saveProblem = over ? null : sqlProblem(save.error, save.variables?.sql, draft.sql);
    const header = (
        <ItemHeader
            title={title}
            detail={detail}
            actions={
                <>
                    <Button variant="outline" onClick={() => router.history.push(backHref)}>
                        Cancel
                    </Button>
                    <Button
                        className="tabular-nums"
                        disabled={!body || missing || saveBlocked || save.isPending}
                        onClick={() => body && save.mutate(body)}
                    >
                        {save.isPending
                            ? "Saving…"
                            : numbers
                              ? `${saveLabel} · ${numbers}`
                              : saveLabel}
                    </Button>
                </>
            }
        />
    );
    const editor = (
        <>
            {before}
            <QueryEditor
                draft={draft}
                sources={sources}
                problem={draft.mode === "sql" ? (runProblem ?? saveProblem) : null}
                onChange={setDraft}
                onRun={runNow}
            />
            {over && save.variables ? (
                <SampleOffer
                    total={over.total_rows}
                    limit={over.row_limit}
                    seed={save.variables.sample?.seed}
                    pending={save.isPending}
                    onTake={(sample) =>
                        save.variables && save.mutate({ ...save.variables, sample })
                    }
                />
            ) : (
                <ErrorLine error={saveProblem?.message} />
            )}
        </>
    );
    return (
        <>
            <SplitDetail
                header={header}
                about={editor}
                side={EDITOR_SIDE}
                preview={
                    <QueryPreviewPanel
                        preview={preview}
                        idle={
                            draft.mode === "sql"
                                ? "Write a query to see its rows."
                                : "Pick a source, an input and a label to see the rows."
                        }
                    />
                }
            />
            {guard.dialog}
        </>
    );
}

function prefilledDraft(picked: SourceSummary[]): Draft {
    if (picked.length === 1) {
        return pickedDraft(picked[0]);
    }
    if (picked.length === 0) {
        return EMPTY_DRAFT;
    }
    const [input, label] = guessPair(sharedColumns(picked));
    return {
        ...EMPTY_DRAFT,
        mode: "sql",
        sql: input ? stackedSql(picked, input, label) : unionSql(picked),
    };
}

function backFrom(picked: SourceSummary[], folder: number | null): ItemRef {
    if (folder !== null) {
        return { kind: "folder", id: folder };
    }
    return picked.length === 1 ? sourceRef(picked[0]) : DATASETS_GROUP;
}

const NEW_DATASET_HELP = "Creating the dataset saves version 1 of its rows.";

export function NewDatasetPage({
    sources,
    datasets,
    index,
    prefill,
}: {
    sources: SourceSummary[];
    datasets: DatasetSummary[];
    index: FolderIndex;
    prefill: { sources: number[]; folder: number | null };
}) {
    const refresh = useDataRefresh();
    const picked = prefill.sources.flatMap((id) => sources.filter((source) => source.id === id));
    const folder =
        prefill.folder !== null && index.byId.has(prefill.folder) ? prefill.folder : null;
    const [initial] = useState(() => prefilledDraft(picked));
    const siblings = datasetsIn(datasets, folder);
    const [typed, setTyped] = useState<string | null>(null);
    const suggested = defaultName(picked);
    const name = typed ?? (suggested ? freeDatasetName(siblings, suggested) : "");
    const problem = datasetNameProblem(siblings, name);
    return (
        <QueryWorkbench
            title="New dataset"
            detail={
                folder === null
                    ? NEW_DATASET_HELP
                    : `In ${folderPath(index, folder)}. ${NEW_DATASET_HELP}`
            }
            dataset={null}
            initial={initial}
            sources={sources}
            saveLabel="Create dataset"
            saveBlocked={problem !== null}
            edited={typed !== null}
            backHref={itemHref(backFrom(picked, folder))}
            before={
                <FormRows labels="compact">
                    <FormRow id="new-dataset-name" label="Name">
                        <FormControl width="text">
                            <Input
                                id="new-dataset-name"
                                value={name}
                                maxLength={80}
                                placeholder="Support tickets by team"
                                aria-invalid={problem ? true : undefined}
                                onChange={(event) => setTyped(event.target.value)}
                            />
                            {problem && <p className="text-sm text-destructive">{problem}</p>}
                        </FormControl>
                    </FormRow>
                </FormRows>
            }
            onSave={async (body) => {
                const first = sources.find((item) => item.id === body.source_id)?.name;
                const fallback = freeDatasetName(
                    siblings,
                    suggested || stem(first ?? "") || "New dataset",
                );
                const created = await unwrap(
                    api.POST("/api/datasets", {
                        body: { name: name.trim() || fallback, folder_id: folder, ...body },
                    }),
                );
                await refresh();
                return created.slug;
            }}
        />
    );
}

export function EditQueryPage({
    dataset,
    sources,
}: {
    dataset: DatasetSummary;
    sources: SourceSummary[];
}) {
    const refresh = useDatasetRefresh(dataset.slug);
    const [initial] = useState(() =>
        savedDraft(dataset.mapping, dataset.mode, dataset.source_id, sources),
    );
    const path = { params: { path: { slug: dataset.slug } } };
    return (
        <QueryWorkbench
            title={`${dataset.name} · Edit query`}
            detail="Saving makes the next version of the dataset."
            dataset={dataset.slug}
            initial={initial}
            sources={sources}
            saveLabel="Save query"
            backHref={datasetHref(dataset.slug)}
            onSave={async (body) => {
                await unwrap(api.PUT("/api/datasets/{slug}/mapping", { ...path, body }));
                await refresh();
                return dataset.slug;
            }}
        />
    );
}
