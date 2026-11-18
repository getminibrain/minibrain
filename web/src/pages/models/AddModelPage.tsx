import { IconCubePlus } from "@tabler/icons-react";
import { useMutation } from "@tanstack/react-query";
import { useRouter, useRouterState } from "@tanstack/react-router";
import { useToast } from "obp-ui";
import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import {
    type CatalogEntry,
    type DatasetSummary,
    type DemoDataInfo,
    type ModelRow,
    api,
    unwrap,
} from "~/api/client";
import { useDatasetVersions } from "~/api/dataQueries";
import { useAllModels, useCatalog, useDatasets, useDemoData } from "~/api/queries";
import { CreateLayout, FormCard } from "~/components/CreateLayout";
import { FormControl, FormGroup, FormRow } from "~/components/FormRows";
import { PageHeader } from "~/components/PageHeader";
import { PickSelect } from "~/components/PickSelect";
import { ErrorLine, Page, errorMessage } from "~/components/Section";
import { type Identity, NameAvatarField, newIdentity } from "~/components/avatar/NameAvatarField";
import { avatarBody } from "~/components/avatar/avatarSvg";
import { generateName } from "~/lib/avatarNames";
import { count } from "~/lib/format";
import { modelPageHref, trainHref } from "~/lib/modelLinks";
import { modelsHref } from "~/lib/modelsSearch";
import { bytes } from "~/lib/time";
import { useSourceAdder } from "../data/AddSource";
import { SampleOffer, type SampleRequest, overLimitOf, useOverLimit } from "../data/SampleOffer";
import {
    AddModelNotices,
    AddModelSummary,
    Formats,
    Licence,
    servesOnlyOf,
} from "./AddModelSummary";
import { ApiNameHint } from "./ApiNameHint";
import { BasePicker, type PickerTab } from "./BasePicker";
import { type ImportPick, useSourcePlan } from "./BaseSource";
import { BaseSummary, diskBlocks, diskNeed } from "./BaseSummary";
import {
    BLANK_OUTPUT,
    OUTPUT_DETAIL_ID,
    OutputField,
    outputBody,
    outputProblem,
    suggestedDraft,
    useOutputSuggestion,
} from "./OutputField";
import { UploadDatasetDialog, useDatasetMaker } from "./UploadDatasetDialog";
import {
    type BaseOption,
    baseOptionFor,
    catalogueOption,
    recommend,
    servesOnly,
} from "./baseOptions";
import { useModelsRefresh } from "./dialogs";
import { FormatHelp } from "./formats";
import { isTaken, takenNames } from "./names";

type Problems = {
    model?: string;
    dataset?: string;
    output?: string;
    name?: string;
    licence?: string;
};

const PROBLEM_ORDER: (keyof Problems)[] = ["model", "dataset", "output", "name", "licence"];

const FIELD_IDS: Record<keyof Problems, string> = {
    model: "base-model",
    dataset: "create-dataset",
    output: OUTPUT_DETAIL_ID,
    name: "create-name",
    licence: "create-licence",
};

function FieldError({ text }: { text: string | undefined }) {
    return text ? <p className="text-sm text-destructive">{text}</p> : null;
}

const UPLOAD_NEW = "upload-new";

const DEMO_PREFIX = "demo:";

type Picked =
    | { kind: "base"; key: string }
    | { kind: "catalogue"; id: string; variant: string }
    | { kind: "import"; text: string; connection: number | null };

type Search = {
    base?: string;
    source?: string;
    model?: string;
    variant?: string;
    dataset?: string;
    data?: string | number;
};

function trainsOn(params: Search, dataset: string | null): number | null {
    const data = Number(params.data);
    return params.data !== undefined && Number.isInteger(data) && dataset === String(params.dataset)
        ? data
        : null;
}

function TrainsOnNote({ slug, data }: { slug: string | null; data: number | null }) {
    const versions = useDatasetVersions(slug ?? "", data !== null);
    const number = versions.data?.find((item) => item.id === data)?.number;
    if (data === null || number === undefined || number === null) {
        return null;
    }
    return (
        <span className="text-sm text-muted-foreground tabular-nums">
            {`After creating, Train opens with v${number} picked.`}
        </span>
    );
}

function initialPick(params: Search): Picked | null {
    if (params.model) {
        return {
            kind: "catalogue",
            id: String(params.model),
            variant: params.variant ? String(params.variant) : "",
        };
    }
    return params.base ? { kind: "base", key: String(params.base) } : null;
}

function chosenOption(
    current: Picked | null,
    entries: CatalogEntry[],
    rows: ModelRow[],
): BaseOption | null {
    if (current?.kind === "base") {
        return baseOptionFor(current.key, entries, rows);
    }
    if (current?.kind === "catalogue") {
        const entry = entries.find((item) => item.id === current.id);
        return entry ? catalogueOption(entry, current.variant || undefined) : null;
    }
    return null;
}

function heldOutOf(dataset: DatasetSummary | null): number | null {
    const counts = dataset?.dataset_version?.counts ?? dataset?.splits ?? null;
    return counts ? (counts.eval ?? 0) : null;
}

function rowsMeta(dataset: DatasetSummary): string | null {
    const sample = dataset.dataset_version?.sample;
    if (sample) {
        return `${count(sample.rows)} of ${count(sample.total)} rows sampled`;
    }
    return dataset.rows === null ? null : `${count(dataset.rows)} rows`;
}

function datasetMeta(dataset: DatasetSummary): string {
    const number = dataset.dataset_version?.number;
    return [rowsMeta(dataset), number ? `v${number}` : "no version"].filter(Boolean).join(" · ");
}

function outcomeOf(dataset: DatasetSummary | null): string {
    const heldOut = heldOutOf(dataset);
    if (heldOut === null) {
        return "v0 · untrained baseline";
    }
    return `v0 · untrained baseline, scored on ${count(heldOut)} held-out rows`;
}

function unusedDemos(demos: DemoDataInfo[], datasets: DatasetSummary[]): DemoDataInfo[] {
    const names = new Set(datasets.map((dataset) => dataset.name.toLowerCase()));
    return demos.filter((demo) => !names.has(demo.name.toLowerCase()));
}

function DatasetPicker({
    value,
    datasets,
    demos,
    invalid,
    onChange,
    onUpload,
    onDemo,
}: {
    value: string | null;
    datasets: DatasetSummary[];
    demos: DemoDataInfo[];
    invalid: boolean;
    onChange: (slug: string) => void;
    onUpload: () => void;
    onDemo: (demo: DemoDataInfo) => void;
}) {
    const pick = (next: string) => {
        if (next === UPLOAD_NEW) {
            onUpload();
            return;
        }
        const demo = demos.find((item) => `${DEMO_PREFIX}${item.file}` === next);
        if (demo) {
            onDemo(demo);
            return;
        }
        onChange(next);
    };
    return (
        <PickSelect
            id="create-dataset"
            value={value}
            placeholder="Pick a dataset"
            invalid={invalid}
            onChange={pick}
            options={[
                ...datasets.map((dataset) => ({
                    value: dataset.slug,
                    label: dataset.name,
                    meta: datasetMeta(dataset),
                    disabled: Boolean(dataset.dataset_version?.too_few_rows),
                    description: dataset.dataset_version?.too_few_rows ?? undefined,
                })),
                {
                    value: UPLOAD_NEW,
                    label: "Upload new…",
                    separated: datasets.length > 0,
                },
                ...demos.map((demo) => ({
                    value: `${DEMO_PREFIX}${demo.file}`,
                    label: demo.name,
                    meta: `${count(demo.rows)} rows · ${count(demo.labels)} labels`,
                    group: "Demo data",
                })),
            ]}
        />
    );
}

export function AddModelPage() {
    const router = useRouter();
    const refresh = useModelsRefresh();
    const toast = useToast();
    const params = useRouterState({ select: (state) => state.location.search as Search });
    const models = useAllModels();
    const catalog = useCatalog();
    const datasets = useDatasets();
    const [picked, setPicked] = useState<Picked | null>(() => initialPick(params));
    const [accepted, setAccepted] = useState(false);
    const [open, setOpen] = useState(params.source === "import");
    const [tab, setTab] = useState<PickerTab>(params.source === "import" ? "imports" : "catalogue");
    const [dataset, setDataset] = useState<string | null>(
        params.dataset === undefined ? null : String(params.dataset),
    );
    const entries = catalog.data?.entries ?? [];
    const rows = models.data ?? [];
    const datasetList = datasets.data ?? [];
    const chosenDataset = datasetList.find((item) => item.slug === dataset) ?? null;
    const chosenSlug = chosenDataset?.slug ?? null;
    const demoData = useDemoData();
    const demos = unusedDemos(demoData.data ?? [], datasetList);
    const [uploading, setUploading] = useState(false);
    const [addingDemo, setAddingDemo] = useState<DemoDataInfo | null>(null);
    const maker = useDatasetMaker(datasetList, (slug) => {
        setAddingDemo(null);
        setDataset(slug);
    });
    const demoAdder = useSourceAdder((source) =>
        maker.mutate({ source, name: addingDemo?.name ?? source.name }),
    );
    const addDemo = (demo: DemoDataInfo) => {
        setAddingDemo(demo);
        demoAdder.addDemo(demo.file);
    };
    const demoBusy = demoAdder.pending !== null || maker.isPending;
    const demoOver = useOverLimit(maker.error, maker.isPending && Boolean(maker.variables?.sample));
    const suggestion = useOutputSuggestion(chosenSlug);
    const [output, setOutput] = useState(BLANK_OUTPUT);
    useEffect(() => {
        if (chosenSlug && suggestion.data && output.dataset !== chosenSlug) {
            setOutput(suggestedDraft(chosenSlug, suggestion.data));
        }
    }, [chosenSlug, suggestion.data, output.dataset]);
    const picks = recommend(entries, rows, "general");
    const top = picks.here[0] ?? picks.unchecked[0] ?? picks.more[0];
    const fallback: Picked | null = top?.entry
        ? { kind: "catalogue", id: top.entry.id, variant: top.variant?.id ?? "" }
        : null;
    const current = picked ?? fallback;
    const option = chosenOption(current, entries, rows);
    const plan = useSourcePlan({
        text: option?.entry ? option.entry.id : current?.kind === "import" ? current.text : "",
        variant: option?.variant?.id ?? "",
        accepted,
        connection: current?.kind === "import" ? current.connection : null,
    });
    const need = diskNeed(option, plan, catalog.data?.store_free_bytes);
    const choose = (next: Picked) => {
        setPicked(next);
        setAccepted(false);
        setOpen(false);
    };
    const pick = (chosen: BaseOption) =>
        choose(
            chosen.entry
                ? { kind: "catalogue", id: chosen.entry.id, variant: chosen.variant?.id ?? "" }
                : { kind: "base", key: chosen.baseKey ?? "" },
        );
    const importPick = (found: ImportPick) => {
        if (found.kind === "catalogue") {
            choose({ kind: "catalogue", id: found.entry.id, variant: found.variant });
            setAccepted(found.accepted);
            return;
        }
        choose({ kind: "import", text: found.text, connection: found.connection });
    };
    const taken = takenNames(rows);
    const nameTaken = (candidate: string) => isTaken(candidate, taken);
    const [identity, setIdentity] = useState<Identity>(() => newIdentity(nameTaken));
    const firstName = useRef(identity.name);
    const loaded = models.isSuccess;
    useEffect(() => {
        if (loaded && identity.name === firstName.current && isTaken(identity.name, taken)) {
            const fresh = generateName((candidate) => isTaken(candidate, taken));
            firstName.current = fresh;
            setIdentity((current) => ({ ...current, name: fresh }));
        }
    }, [loaded, identity.name, taken]);
    const name = identity.name;
    const nameTouched = name !== firstName.current;
    const [attempted, setAttempted] = useState(false);
    const cancel = () => router.history.push(modelsHref());
    const resolvedBase = useRef<string | null>(null);
    const add = useMutation({
        mutationFn: async ({ slug, sample }: { slug: string; sample?: SampleRequest }) => {
            const baseModel =
                option?.kind === "local" && option.baseKey
                    ? option.baseKey
                    : sample && resolvedBase.current !== null
                      ? resolvedBase.current
                      : await plan.run();
            resolvedBase.current = baseModel;
            return unwrap(
                api.POST("/api/models", {
                    body: {
                        name: name.trim(),
                        base_model: baseModel || null,
                        ...outputBody(output),
                        dataset: slug,
                        avatar: avatarBody(identity.avatar),
                        sample: sample ?? null,
                    },
                }),
            );
        },
        onError: (error) => {
            if (overLimitOf(error)) {
                toast({
                    title: "The dataset has more rows than the limit",
                    description: "Take a random sample under Dataset to create the model.",
                    tone: "warning",
                });
                return;
            }
            toast({
                title: "The model was not created",
                description: errorMessage(error),
                tone: "destructive",
            });
        },
        onSuccess: async (created) => {
            await refresh();
            toast({
                title: "Model created",
                description: need
                    ? `${created.name}. ${need.verb === "import" ? "Importing" : "Downloading"} ${option?.name ?? "the base model"} (${bytes(need.size)}) first.`
                    : servesOnly(option)
                      ? `${created.name}. Its base serves but can't be fine-tuned.`
                      : `${created.name}: v0 is being scored.`,
                tone: "success",
            });
            const data = trainsOn(params, created.dataset ?? null);
            router.history.push(
                data === null ? modelPageHref(created.slug) : trainHref(created.slug, { data }),
            );
        },
    });
    const baseReady =
        (option?.kind === "local" ? Boolean(option.baseKey) : plan.ready) && !diskBlocks(need);
    const finalName = name.trim();
    const changeVariant = (variant: string) => {
        if (option?.entry) {
            setPicked({ kind: "catalogue", id: option.entry.id, variant });
            setAccepted(false);
        }
    };
    const licencePending =
        plan.target.kind === "catalogue" && !plan.installedKey && !plan.blocked && !accepted;
    const problems: Problems = {
        model:
            !option && current?.kind !== "import"
                ? "Pick a base model."
                : plan.blocked && !plan.installedKey
                  ? plan.blocked
                  : diskBlocks(need)
                    ? "Not enough disk space for this model. Free some space or pick a smaller one."
                    : current?.kind === "import" && !plan.ready && !licencePending
                      ? "Check the import location first."
                      : undefined,
        dataset: !dataset
            ? "Pick a dataset."
            : datasets.isSuccess && !chosenDataset
              ? `No dataset called ${dataset}. Pick another.`
              : (chosenDataset?.dataset_version?.too_few_rows ?? undefined),
        output: outputProblem(output),
        name: !finalName
            ? "Name the model."
            : !/[A-Za-z0-9]/.test(finalName)
              ? "Use at least one letter or number."
              : isTaken(finalName, taken)
                ? `A model called ${finalName} already exists. Pick another name.`
                : undefined,
        licence: licencePending ? "Accept the licence to download this model." : undefined,
    };
    const blocked = PROBLEM_ORDER.map((field) => problems[field]).filter((text): text is string =>
        Boolean(text),
    );
    const ready = baseReady && blocked.length === 0 && Boolean(chosenDataset);
    const shown = attempted ? blocked : [];
    const shownFor = (field: keyof Problems) => (attempted ? problems[field] : undefined);
    const submit = () => {
        if (add.isPending) {
            return;
        }
        if (!ready || !chosenDataset) {
            setAttempted(true);
            const first = PROBLEM_ORDER.find((field) => problems[field]);
            if (first) {
                document.getElementById(FIELD_IDS[first])?.focus();
            }
            return;
        }
        add.mutate({ slug: chosenDataset.slug });
    };
    const shortcut = (event: KeyboardEvent<HTMLFormElement>) => {
        if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            submit();
        }
    };
    const overLimit = useOverLimit(add.error, add.isPending && Boolean(add.variables?.sample));
    const over = add.variables?.slug === chosenSlug ? overLimit : null;
    const outcome = outcomeOf(chosenDataset);
    const showFormat = plan.target.kind === "catalogue" && Boolean(plan.variant);
    const form = (
        <FormCard>
            <FormGroup>
                <FormRow id="base-model" label="Base" align="start">
                    <FormControl>
                        <BasePicker
                            value={{
                                option,
                                importText: current?.kind === "import" ? current.text : null,
                            }}
                            catalog={catalog.data}
                            models={rows}
                            picks={picks}
                            open={open}
                            onOpenChange={setOpen}
                            tab={tab}
                            onTabChange={setTab}
                            onPick={pick}
                            onImport={importPick}
                        />
                        {catalog.isLoading && (
                            <span className="text-sm text-muted-foreground">
                                Loading the catalogue…
                            </span>
                        )}
                        <ErrorLine error={catalog.error} onRetry={catalog.refetch} />
                        <BaseSummary option={option} plan={plan} />
                        <FieldError text={shownFor("model")} />
                    </FormControl>
                </FormRow>
                {showFormat && (
                    <FormRow id="create-format" label="Format" tip={<FormatHelp />}>
                        <FormControl>
                            <Formats
                                plan={plan}
                                variant={plan.variant ?? option?.variant ?? null}
                                servesOnly={servesOnlyOf(option, plan)}
                                onVariant={changeVariant}
                            />
                        </FormControl>
                    </FormRow>
                )}
                <FormRow
                    id="create-dataset"
                    label="Dataset"
                    align={over || trainsOn(params, dataset) !== null ? "start" : undefined}
                >
                    <FormControl>
                        <DatasetPicker
                            value={dataset}
                            datasets={datasetList}
                            demos={demoBusy ? [] : demos}
                            invalid={Boolean(shownFor("dataset"))}
                            onChange={setDataset}
                            onUpload={() => setUploading(true)}
                            onDemo={addDemo}
                        />
                        <TrainsOnNote slug={dataset} data={trainsOn(params, dataset)} />
                        {demoBusy && addingDemo && (
                            <span className="text-sm text-muted-foreground">
                                {`Adding ${addingDemo.name}…`}
                            </span>
                        )}
                        <ErrorLine error={datasets.error} onRetry={datasets.refetch} />
                        {demoOver && maker.variables ? (
                            <SampleOffer
                                subject="file"
                                total={demoOver.total_rows}
                                limit={demoOver.row_limit}
                                pending={maker.isPending}
                                onTake={(sample) =>
                                    maker.variables && maker.mutate({ ...maker.variables, sample })
                                }
                            />
                        ) : (
                            <ErrorLine error={demoAdder.error ?? maker.error} />
                        )}
                        {over && chosenSlug && (
                            <SampleOffer
                                subject="dataset"
                                total={over.total_rows}
                                limit={over.row_limit}
                                pending={add.isPending}
                                onTake={(sample) => add.mutate({ slug: chosenSlug, sample })}
                            />
                        )}
                        <UploadDatasetDialog
                            open={uploading}
                            datasets={datasetList}
                            onOpenChange={setUploading}
                            onCreated={setDataset}
                        />
                        <FieldError text={shownFor("dataset")} />
                    </FormControl>
                </FormRow>
                {chosenDataset && (
                    <OutputField
                        draft={output}
                        loading={suggestion.isLoading}
                        error={shownFor("output")}
                        onChange={setOutput}
                    />
                )}
                <NameAvatarField
                    id="create-name"
                    labelled={false}
                    value={identity}
                    onChange={setIdentity}
                    taken={nameTaken}
                    error={nameTouched || attempted ? problems.name : undefined}
                    rows={{
                        name: (node) => (
                            <>
                                <FormRow id="create-name" label="Name" align="start">
                                    <FormControl width="text">{node}</FormControl>
                                </FormRow>
                                <FormRow
                                    id="create-api-name"
                                    label="API name"
                                    tip="Apps call the model by this name. It never changes, and is never reused."
                                >
                                    <FormControl width="text">
                                        <ApiNameHint name={name} bare />
                                    </FormControl>
                                </FormRow>
                            </>
                        ),
                        avatar: (node) => (
                            <FormRow label="Avatar" align="start">
                                {node}
                            </FormRow>
                        ),
                    }}
                />
                {option?.entry && (
                    <FormRow label="Licence" align="start">
                        <FormControl width="full">
                            <Licence
                                id="create-licence"
                                option={option}
                                plan={plan}
                                accepted={accepted}
                                onAccepted={setAccepted}
                            />
                            <FieldError text={shownFor("licence")} />
                        </FormControl>
                    </FormRow>
                )}
            </FormGroup>
            <AddModelNotices
                option={option}
                plan={plan}
                need={need}
                catalog={catalog.data}
                onVariant={changeVariant}
                onPickAnother={() => setOpen(true)}
            />
        </FormCard>
    );
    return (
        <Page>
            <PageHeader
                title="Add model"
                caption="Start from a base model and a dataset; v0 is the untrained baseline."
                crumbs={[{ label: "Models", href: modelsHref() }, { label: "Add model" }]}
            />
            <CreateLayout
                form={form}
                summary={
                    <AddModelSummary
                        option={option}
                        plan={plan}
                        need={need}
                        free={catalog.data?.store_free_bytes}
                        catalog={catalog.data}
                        outcome={outcome}
                        blocked={[]}
                    />
                }
                submit={
                    <>
                        <IconCubePlus />
                        {add.isPending ? "Creating…" : "Create model"}
                    </>
                }
                disabled={add.isPending || shown.length > 0}
                status={
                    shown.length > 1
                        ? `Fix the ${shown.length} fields marked in red`
                        : (shown[0] ?? "")
                }
                problem={shown.length > 0}
                onSubmit={submit}
                onCancel={cancel}
                onKeyDown={shortcut}
            />
        </Page>
    );
}
