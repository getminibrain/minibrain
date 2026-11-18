import {
    IconArrowLeft,
    IconDeviceFloppy,
    IconNotes,
    IconPlayerPlay,
    IconPlus,
    IconX,
} from "@tabler/icons-react";
import { useMutation } from "@tanstack/react-query";
import { useBlocker, useRouter } from "@tanstack/react-router";
import {
    Button,
    ConfirmDialog,
    Field,
    FieldGroup,
    Input,
    Kbd,
    Link,
    Popover,
    PopoverContent,
    PopoverTrigger,
    SegmentedTabs,
    type SqlEditorHandle,
    Textarea,
    Tooltip,
    TooltipContent,
    TooltipTrigger,
    cn,
} from "obp-ui";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { type DatasetSummary, type SourceSummary, api, unwrap } from "~/api/client";
import { useDataSettings } from "~/api/dataQueries";
import { ErrorLine } from "~/components/Section";
import { TAGS_HINT, editableTags } from "~/components/Tags";
import { sqlProblem } from "~/lib/sqlError";
import { useResizableWidth } from "~/lib/useResizableWidth";
import { splitTags } from "../models/dialogs";
import { useDatasetRefresh } from "./DatasetDetail";
import { type Fix, type FixContext, type Limits, limitsOf } from "./QualityTab";
import {
    type Draft,
    MODES,
    type MappingBody,
    QueryEditor,
    chosenSources,
    draftBody,
    pickedDraft,
    previewSql,
    sameDraft,
    savedDraft,
    switchedDraft,
    withRole,
} from "./QueryEditor";
import {
    AUTO_RUN_ROWS,
    type Focus,
    QueryPreviewPanel,
    type QueryShape,
    useLivePreview,
    useSettled,
} from "./QueryPreview";
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
import { NO_CLEANUP, affectedStep, wrappedSql } from "./cleanup";
import { type Described, ResizeHandle, useDataRefresh } from "./parts";
import { defaultName, mentions, sharedColumns, unionSql } from "./sql";

const QUERY_WIDTH = { key: "minibrain.data.editorQueryWidth", initial: null, min: 416, max: 2400 };

const EMPTY_DRAFT: Draft = {
    mode: "columns",
    sources: [],
    input: "",
    label: "",
    skipEmpty: true,
    cleanup: NO_CLEANUP,
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

const RUN_KEYS =
    typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.userAgent)
        ? "⌘↵"
        : "Ctrl+↵";

function queriedSources(
    draft: Draft,
    sources: SourceSummary[],
    alias: SourceSummary | null,
): SourceSummary[] {
    if (draft.mode === "columns") {
        return chosenSources(draft, sources);
    }
    const named = sources.filter((source) => mentions(draft.sql, source.table));
    return alias && !named.includes(alias) && mentions(draft.sql, "source")
        ? [...named, alias]
        : named;
}

function rowsToRead(found: SourceSummary[]): number | null {
    let total = 0;
    for (const source of found) {
        if (source.rows === null || source.rows === undefined) {
            return null;
        }
        total += source.rows;
    }
    return total;
}

function waitingText(settled: string | null, stale: boolean): string | null {
    if (!stale) {
        return null;
    }
    return settled === null
        ? "Large sources: press Run to preview"
        : "Changed since the last run: press Run to update";
}

function useRunKey(run: () => void) {
    const latest = useRef(run);
    latest.current = run;
    useEffect(() => {
        const onKey = (event: KeyboardEvent) => {
            if (
                event.key !== "Enter" ||
                !(event.metaKey || event.ctrlKey) ||
                event.defaultPrevented
            ) {
                return;
            }
            event.preventDefault();
            latest.current();
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, []);
}

type Fixed = { done: string; before: number; live: string | null };

function fixContext(shape: QueryShape | undefined, limits: Limits | null): FixContext {
    const quality = shape?.quality;
    const usable = quality ? quality.rows - quality.empty : 0;
    const average = quality && quality.labels > 0 ? Math.ceil(usable / quality.labels) : 0;
    return {
        limits,
        perLabel: Math.max(limits?.minLabelRows ?? 1, average, 1),
        rare: Boolean(quality && limits && quality.smallest_label < limits.minLabelRows),
    };
}

function focusedSql(focus: Focus | null, settled: string | null, limits: Limits | null) {
    if (!focus || !settled || !limits) {
        return null;
    }
    const step = affectedStep(focus.check, limits, focus.majority);
    return step ? wrappedSql(settled, step) : null;
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

function DetailsPopover({
    details,
    note,
    onChange,
}: {
    details: Details;
    note: ReactNode;
    onChange: (details: Details) => void;
}) {
    const filled = [details.description.trim() !== "", details.tags.trim() !== ""].filter(
        Boolean,
    ).length;
    return (
        <Popover>
            <PopoverTrigger asChild>
                <Button variant="ghost" size="sm">
                    <IconNotes />
                    Details
                    {filled > 0 && (
                        <span className="text-sm text-muted-foreground tabular-nums">{filled}</span>
                    )}
                </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-96">
                <FieldGroup>
                    <p className="text-sm text-muted-foreground">{note}</p>
                    <Field id="dataset-description" label="Description">
                        <Textarea
                            id="dataset-description"
                            value={details.description}
                            maxLength={1000}
                            rows={3}
                            onChange={(event) =>
                                onChange({ ...details, description: event.target.value })
                            }
                        />
                    </Field>
                    <Field id="dataset-tags" label="Tags" hint={TAGS_HINT}>
                        <Input
                            id="dataset-tags"
                            value={details.tags}
                            onChange={(event) => onChange({ ...details, tags: event.target.value })}
                        />
                    </Field>
                </FieldGroup>
            </PopoverContent>
        </Popover>
    );
}

function TitleField({
    name,
    placeholder,
    problem,
    onChange,
}: {
    name: string;
    placeholder: string;
    problem: string | null;
    onChange: (name: string) => void;
}) {
    return (
        <span className="flex min-w-32 max-w-96 flex-1 items-center gap-2">
            <Input
                id="dataset-name"
                aria-label="Dataset name"
                value={name}
                maxLength={80}
                placeholder={placeholder}
                aria-invalid={problem ? true : undefined}
                aria-describedby={problem ? "dataset-name-problem" : undefined}
                onChange={(event) => onChange(event.target.value)}
                className="min-w-0 flex-1 border-transparent bg-transparent text-lg font-semibold hover:border-input focus-visible:border-ring"
            />
            {problem && (
                <span
                    id="dataset-name-problem"
                    className="max-w-48 shrink-0 truncate text-sm text-destructive"
                    title={problem}
                >
                    {problem}
                </span>
            )}
        </span>
    );
}

function DatasetWorkbench({
    title,
    detail,
    dataset,
    alias = null,
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
    alias?: SourceSummary | null;
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
    const limits = limitsOf(useDataSettings().data);
    const chars = limits?.charsPerToken ?? null;
    const sqlEditor = useRef<SqlEditorHandle>(null);
    const live = previewSql(draft, sources, chars);
    const reading = rowsToRead(queriedSources(draft, sources, alias));
    const auto = reading !== null && reading < AUTO_RUN_ROWS;
    const { settled, stale, runNow } = useSettled(live, draft.mode === "columns", auto);
    const [focus, setFocus] = useState<Focus | null>(null);
    const [fixed, setFixed] = useState<Fixed | null>(null);
    const preview = useLivePreview(settled, dataset, focusedSql(focus, settled, limits));
    const waiting = waitingText(settled, stale);
    const context = fixContext(preview.counted, limits);
    const effect =
        fixed && fixed.live === live
            ? {
                  done: fixed.done,
                  before: fixed.before,
                  after: settled === fixed.live && preview.counted ? preview.counted.rows : null,
              }
            : null;
    const applyFix = async (fix: Fix) => {
        const before = preview.counted?.rows;
        if (before === undefined) {
            return;
        }
        setFocus(null);
        let next: string | null = null;
        if (draft.mode === "columns") {
            const changed = { ...draft, cleanup: { ...draft.cleanup, ...fix.cleanup } };
            setDraft(changed);
            next = previewSql(changed, sources, chars);
        } else {
            const text = await sqlEditor.current?.replace(wrappedSql(draft.sql, fix.step), {
                format: true,
            });
            next = text?.trim() || null;
        }
        setFixed({ done: fix.done, before, live: next });
        if (!auto && next) {
            runNow(next);
        }
    };
    const run = () => {
        if (live === null) {
            return;
        }
        if (live === settled) {
            preview.rerun();
        } else {
            runNow(live);
        }
    };
    useRunKey(run);
    const queryChanged = creating || !sameDraft(draft, initialDraft);
    const detailsChanged = !sameDetails(details, initialDetails);
    const guard = useLeaveGuard(detailsChanged || !sameDraft(draft, initialDraft));
    const queryBox = useFocusWithin(focusQuery);
    const split = useResizableWidth(QUERY_WIDTH);
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
        <header className="flex h-14 shrink-0 items-center gap-3 border-b px-4">
            <nav aria-label="Breadcrumb" className="flex shrink-0 items-center gap-1">
                <Tooltip>
                    <TooltipTrigger asChild>
                        <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label="Back"
                            onClick={() => router.history.push(backHref)}
                        >
                            <IconArrowLeft />
                        </Button>
                    </TooltipTrigger>
                    <TooltipContent>Back</TooltipContent>
                </Tooltip>
                <Link
                    href={itemHref(DATASETS_GROUP)}
                    className="text-muted-foreground hover:text-foreground"
                >
                    Data
                </Link>
                <span aria-hidden="true" className="text-muted-foreground">
                    /
                </span>
            </nav>
            <TitleField
                name={details.name}
                placeholder={title}
                problem={problem}
                onChange={(name) => setDetails({ ...details, name })}
            />
            <DetailsPopover details={details} note={detail} onChange={setDetails} />
            <SegmentedTabs
                size="sm"
                tabs={MODES}
                active={draft.mode}
                onSelect={(next) => setDraft(switchedDraft(draft, next, sources, chars))}
            />
            <div className="ml-auto flex shrink-0 items-center gap-2">
                <Button variant="outline" disabled={live === null} onClick={run}>
                    <IconPlayerPlay />
                    Run
                    <Kbd>{RUN_KEYS}</Kbd>
                </Button>
                <Button variant="outline" onClick={() => router.history.push(backHref)}>
                    <IconX />
                    Cancel
                </Button>
                <Button
                    className="tabular-nums"
                    disabled={!ready || save.isPending}
                    onClick={() => save.mutate({ details: described(details), body })}
                >
                    {creating ? <IconPlus /> : <IconDeviceFloppy />}
                    {save.isPending ? "Saving…" : saveLabel}
                </Button>
            </div>
        </header>
    );
    return (
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            {header}
            <div className="flex min-h-0 flex-1">
                <section
                    ref={queryBox}
                    aria-label="Query"
                    className={cn(
                        "relative flex min-h-0 max-w-[calc(100%-26rem)] min-w-[26rem] shrink-0 flex-col border-r",
                        split.width === null && "w-1/2",
                    )}
                    style={split.width === null ? undefined : { width: split.width }}
                >
                    <div
                        className={cn(
                            "flex min-h-0 flex-1 flex-col gap-3 p-6",
                            draft.mode === "columns" && "overflow-y-auto",
                        )}
                    >
                        <QueryEditor
                            draft={draft}
                            sources={sources}
                            problem={draft.mode === "sql" ? (runProblem ?? saveProblem) : null}
                            chars={chars}
                            cleanupDefaults={{
                                rare: limits?.minLabelRows ?? 10,
                                maxTokens: limits?.longTokens ?? 2048,
                                perLabel: context.perLabel,
                            }}
                            editor={sqlEditor}
                            onChange={setDraft}
                            onRun={(text) => runNow(text, live)}
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
                    </div>
                    <ResizeHandle label="Query" width={split} />
                </section>
                <QueryPreviewPanel
                    preview={preview}
                    waiting={waiting}
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
                    quality={{
                        dataset,
                        context,
                        effect,
                        focus,
                        canFix: draft.mode === "columns" || Boolean(draft.sql.trim()),
                        onShowRows: (check) =>
                            setFocus({
                                check: check.check,
                                title: check.title,
                                rows: check.rows,
                                majority:
                                    check.check === "balance" && !context.rare
                                        ? (check.table[0]?.[0] ?? null)
                                        : null,
                            }),
                        onShowAll: () => setFocus(null),
                        onFix: (fix) => void applyFix(fix),
                    }}
                />
            </div>
            {guard.dialog}
        </div>
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
            alias={
                dataset.sources.length === 1
                    ? (sources.find((source) => source.id === dataset.sources[0]?.id) ?? null)
                    : null
            }
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
