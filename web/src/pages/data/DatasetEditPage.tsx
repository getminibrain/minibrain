import { useMutation } from "@tanstack/react-query";
import { useBlocker, useRouter } from "@tanstack/react-router";
import { Button, ConfirmDialog, Input, Textarea } from "obp-ui";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { type DatasetSummary, type SourceSummary, api, unwrap } from "~/api/client";
import {
    FORM_GROUP_GAP,
    FORM_ROW_GAP,
    FormControl,
    FormRow,
    FormRows,
} from "~/components/FormRows";
import { ErrorLine } from "~/components/Section";
import { TAGS_HINT, editableTags } from "~/components/Tags";
import { sqlProblem } from "~/lib/sqlError";
import { splitTags } from "../models/dialogs";
import { useDatasetRefresh } from "./DatasetDetail";
import {
    type Draft,
    type MappingBody,
    QueryEditor,
    chosenSources,
    draftBody,
    pickedDraft,
    previewSql,
    sameDraft,
    savedDraft,
    withRole,
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
} from "./catalogue";
import { type Described, ItemHeader, SplitDetail, type SplitSide, useDataRefresh } from "./parts";
import { defaultName, sharedColumns, unionSql } from "./sql";

const EDITOR_SIDE: SplitSide = {
    label: "Dataset",
    sizing: { key: "minibrain.data.queryWidth", initial: null, min: 420, max: 1100 },
    widths: "@3xl/data:w-80 @min-[52rem]/detail:w-[26rem] @min-[80rem]/detail:w-1/2",
    className: FORM_GROUP_GAP,
};

const EMPTY_DRAFT: Draft = {
    mode: "columns",
    sources: [],
    input: "",
    label: "",
    skipEmpty: true,
    sql: "",
    guessed: [],
};

type Details = { name: string; description: string; tags: string };

type Saving = { details: Described; body: MappingBody | null };

function detailsOf(item: Described): Details {
    return { name: item.name, description: item.description, tags: editableTags(item.tags) };
}

function described(details: Details): Described {
    return {
        name: details.name.trim(),
        description: details.description.trim(),
        tags: splitTags(details.tags),
    };
}

function sameDetails(left: Details, right: Details): boolean {
    const [a, b] = [described(left), described(right)];
    return a.name === b.name && a.description === b.description && a.tags.join() === b.tags.join();
}

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
            description="The changes you made here are not saved."
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

function useFocusWithin(focus: boolean) {
    const box = useRef<HTMLElement>(null);
    useEffect(() => {
        if (!focus) {
            return;
        }
        let tries = 0;
        const timer = window.setInterval(() => {
            const target = box.current?.querySelector<HTMLElement>(
                "[contenteditable='true'], #dataset-source",
            );
            tries += 1;
            if (target || tries > 40) {
                window.clearInterval(timer);
                box.current?.scrollIntoView({ block: "start" });
                target?.focus();
            }
        }, 50);
        return () => window.clearInterval(timer);
    }, [focus]);
    return box;
}

function DetailsFields({
    details,
    problem,
    onChange,
}: {
    details: Details;
    problem: string | null;
    onChange: (details: Details) => void;
}) {
    return (
        <FormRows labels="compact">
            <FormRow id="dataset-name" label="Name">
                <FormControl width="text">
                    <Input
                        id="dataset-name"
                        value={details.name}
                        maxLength={80}
                        placeholder="Support tickets by team"
                        aria-invalid={problem ? true : undefined}
                        onChange={(event) => onChange({ ...details, name: event.target.value })}
                    />
                    {problem && <p className="text-sm text-destructive">{problem}</p>}
                </FormControl>
            </FormRow>
            <FormRow id="dataset-description" label="Description" align="start">
                <FormControl width="wide">
                    <Textarea
                        id="dataset-description"
                        value={details.description}
                        maxLength={1000}
                        rows={2}
                        onChange={(event) =>
                            onChange({ ...details, description: event.target.value })
                        }
                    />
                </FormControl>
            </FormRow>
            <FormRow id="dataset-tags" label="Tags" align="start">
                <FormControl width="wide">
                    <Input
                        id="dataset-tags"
                        value={details.tags}
                        onChange={(event) => onChange({ ...details, tags: event.target.value })}
                    />
                    <p className="text-sm text-muted-foreground">{TAGS_HINT}</p>
                </FormControl>
            </FormRow>
        </FormRows>
    );
}

function DatasetWorkbench({
    title,
    detail,
    dataset,
    initialDraft,
    initialDetails,
    creating,
    nameProblem,
    focusQuery = false,
    sources,
    saveLabel,
    backHref,
    onSave,
}: {
    title: string;
    detail: ReactNode;
    dataset: string | null;
    initialDraft: Draft;
    initialDetails: Details;
    creating: boolean;
    nameProblem: (name: string) => string | null;
    focusQuery?: boolean;
    sources: SourceSummary[];
    saveLabel: string;
    backHref: string;
    onSave: (saving: Saving) => Promise<string>;
}) {
    const router = useRouter();
    const [draft, setDraft] = useState(initialDraft);
    const [details, setDetails] = useState(initialDetails);
    const live = previewSql(draft, sources);
    const { settled, runNow } = useSettled(live, draft.mode === "columns");
    const preview = useLivePreview(settled, dataset);
    const queryChanged = creating || !sameDraft(draft, initialDraft);
    const detailsChanged = !sameDetails(details, initialDetails);
    const guard = useLeaveGuard(detailsChanged || !sameDraft(draft, initialDraft));
    const queryBox = useFocusWithin(focusQuery);
    const save = useMutation({
        mutationFn: onSave,
        onSuccess: (slug) => {
            guard.release();
            router.history.push(datasetHref(slug));
        },
    });
    const over = useOverLimit(save.error, save.isPending && Boolean(save.variables?.body?.sample));
    const body = queryChanged ? draftBody(draft, sources) : null;
    const problem = details.name.trim() ? nameProblem(details.name) : null;
    const current = live !== null && live === settled;
    const numbers = current ? shapeSummary(preview.counted) : null;
    const missing = queryChanged && current && preview.missing.length > 0;
    const ready =
        (detailsChanged || queryChanged) &&
        (!queryChanged || body !== null) &&
        (creating || details.name.trim() !== "") &&
        !missing &&
        problem === null;
    const runProblem = sqlProblem(preview.error, preview.sql ?? undefined, draft.sql);
    const saveProblem = over
        ? null
        : sqlProblem(save.error, save.variables?.body?.sql ?? undefined, draft.sql);
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
                        disabled={!ready || save.isPending}
                        onClick={() => save.mutate({ details: described(details), body })}
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
            <DetailsFields details={details} problem={problem} onChange={setDetails} />
            <section
                ref={queryBox}
                aria-labelledby="dataset-query-title"
                className={`flex min-w-0 scroll-mt-6 flex-col ${FORM_ROW_GAP}`}
            >
                <h3 id="dataset-query-title" className="font-medium">
                    Query
                </h3>
                <QueryEditor
                    draft={draft}
                    sources={sources}
                    problem={draft.mode === "sql" ? (runProblem ?? saveProblem) : null}
                    onChange={setDraft}
                    onRun={runNow}
                />
                {over && save.variables?.body ? (
                    <SampleOffer
                        total={over.total_rows}
                        limit={over.row_limit}
                        seed={save.variables.body.sample?.seed}
                        pending={save.isPending}
                        onTake={(sample) =>
                            save.variables?.body &&
                            save.mutate({
                                ...save.variables,
                                body: { ...save.variables.body, sample },
                            })
                        }
                    />
                ) : (
                    <ErrorLine error={saveProblem?.message} />
                )}
            </section>
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
                                : "Pick a source to see its rows."
                        }
                        pickable={
                            draft.mode === "columns"
                                ? sharedColumns(chosenSources(draft, sources))
                                : undefined
                        }
                        onPick={(column, role) => setDraft(withRole(draft, column, role))}
                    />
                }
            />
            {guard.dialog}
        </>
    );
}

function prefilledDraft(picked: SourceSummary[]): Draft {
    if (picked.length === 0) {
        return EMPTY_DRAFT;
    }
    if (picked.length === 1 || sharedColumns(picked).length > 0) {
        return pickedDraft(picked);
    }
    return { ...EMPTY_DRAFT, mode: "sql", sql: unionSql(picked) };
}

function backFrom(picked: SourceSummary[], folder: number | null): ItemRef {
    if (folder !== null) {
        return { kind: "folder", id: folder };
    }
    return picked.length === 1 ? sourceRef(picked[0]) : DATASETS_GROUP;
}

const NEW_DATASET_HELP = "Creating the dataset saves version 1 of its rows.";

function patchDetails(slug: string, details: Described) {
    return unwrap(api.PATCH("/api/datasets/{slug}", { params: { path: { slug } }, body: details }));
}

export function NewDatasetPage({
    sources,
    datasets,
    index,
    prefill,
}: {
    sources: SourceSummary[];
    datasets: DatasetSummary[];
    index: FolderIndex;
    prefill: { sources: number[]; folder: number | null; focus: string | null };
}) {
    const refresh = useDataRefresh();
    const picked = prefill.sources.flatMap((id) => sources.filter((source) => source.id === id));
    const folder =
        prefill.folder !== null && index.byId.has(prefill.folder) ? prefill.folder : null;
    const siblings = datasetsIn(datasets, folder);
    const [initialDraft] = useState(() => prefilledDraft(picked));
    const [initialDetails] = useState(() => {
        const suggested = defaultName(picked);
        return {
            name: suggested ? freeDatasetName(siblings, suggested) : "",
            description: "",
            tags: "",
        };
    });
    return (
        <DatasetWorkbench
            title="New dataset"
            detail={
                folder === null
                    ? NEW_DATASET_HELP
                    : `In ${folderPath(index, folder)}. ${NEW_DATASET_HELP}`
            }
            dataset={null}
            creating
            initialDraft={initialDraft}
            initialDetails={initialDetails}
            nameProblem={(name) => datasetNameProblem(siblings, name)}
            sources={sources}
            saveLabel="Create dataset"
            backHref={itemHref(backFrom(picked, folder))}
            onSave={async ({ details, body }) => {
                const name = details.name || freeDatasetName(siblings, "New dataset");
                const created = await unwrap(
                    api.POST("/api/datasets", {
                        body: { name, folder_id: folder, ...body },
                    }),
                );
                if (details.description || details.tags.length > 0) {
                    await patchDetails(created.slug, { ...details, name });
                }
                await refresh();
                return created.slug;
            }}
        />
    );
}

export function EditDatasetPage({
    dataset,
    sources,
    index,
    focusQuery,
}: {
    dataset: DatasetSummary;
    sources: SourceSummary[];
    index: FolderIndex;
    focusQuery: boolean;
}) {
    const refresh = useDatasetRefresh(dataset.slug);
    const [initialDraft] = useState(() =>
        savedDraft(
            dataset.mapping,
            dataset.mode,
            dataset.sources.map((source) => source.id),
            sources,
        ),
    );
    const [initialDetails] = useState(() => detailsOf(dataset));
    const siblings = index.datasets.get(dataset.folder_id ?? null) ?? [];
    const path = { params: { path: { slug: dataset.slug } } };
    return (
        <DatasetWorkbench
            title={`Edit ${dataset.name}`}
            detail="Saving a changed query makes the next version of the dataset."
            dataset={dataset.slug}
            creating={false}
            initialDraft={initialDraft}
            initialDetails={initialDetails}
            nameProblem={(name) => datasetNameProblem(siblings, name, dataset.slug)}
            focusQuery={focusQuery}
            sources={sources}
            saveLabel="Save"
            backHref={datasetHref(dataset.slug)}
            onSave={async ({ details, body }) => {
                if (!sameDetails(detailsOf(details), initialDetails)) {
                    await patchDetails(dataset.slug, details);
                }
                if (body) {
                    await unwrap(api.PUT("/api/datasets/{slug}/mapping", { ...path, body }));
                }
                await refresh();
                return dataset.slug;
            }}
        />
    );
}
