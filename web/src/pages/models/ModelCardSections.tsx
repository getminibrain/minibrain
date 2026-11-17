import {
    IconAlertTriangle,
    IconCpu,
    IconCube,
    IconDatabase,
    IconFingerprint,
    IconGauge,
    IconShieldCheck,
    IconTarget,
    IconUser,
} from "@tabler/icons-react";
import type { ColumnDef } from "@tanstack/react-table";
import {
    Badge,
    Button,
    Card,
    CardContent,
    type CompareColumn,
    type CompareRow,
    CompareTable,
    DataGrid,
    InfoTip,
    Link,
} from "obp-ui";
import { type ReactNode, useState } from "react";
import type { components } from "~/api/schema";
import { CopyButton } from "~/components/CopyButton";
import { Facts } from "~/components/Facts";
import { PoolLink } from "~/components/PoolLink";
import { PanelSection, Stat } from "~/components/Section";
import { auditHref } from "~/lib/audit";
import { costText, deviceTime, duration, headline, measuredOn, money, priced } from "~/lib/cost";
import { count, deltaPoints, milliseconds, percent } from "~/lib/format";
import { metricName } from "~/lib/metrics";
import { modelPageHref } from "~/lib/modelLinks";
import { exactTime } from "~/lib/time";
import { itemHref } from "../data/catalogue";
import {
    EndsGrid,
    FOLDED_LABELS,
    LabelChips,
    type ListColumn,
    ShowAll,
    useFolded,
} from "./cardLists";
import { SCHEDULERS } from "./detail/train/recipe";

type Schemas = components["schemas"];
export type ModelCard = Schemas["ModelCard"];
type LabelRows = Schemas["CardLabelRows"];
type LabelScore = Schemas["CardLabelScore"];
type Confusion = Schemas["CardConfusion"];
type Source = Schemas["CardSource"];
type Check = Schemas["CardCheck"];
type Comparison = Schemas["CardComparison"];
type CardEvent = Schemas["CardEvent"];
type Run = Schemas["CardRun"];

type Variant = "success" | "info" | "approval" | "neutral" | "warning" | "destructive";

export const CARD_CONTENTS = [
    { id: "purpose", label: "Purpose" },
    { id: "use", label: "Intended use and owner" },
    { id: "base-model", label: "Base model" },
    { id: "training-data", label: "Training data" },
    { id: "training", label: "Training" },
    { id: "evaluation", label: "Evaluation" },
    { id: "limits", label: "Limits" },
    { id: "deployments", label: "Approvals and deployments" },
    { id: "integrity", label: "Integrity" },
];

const NO_DATA = "No data yet.";

const STATES: Record<string, { variant: Variant; label: string }> = {
    live: { variant: "success", label: "Live" },
    ready_to_deploy: { variant: "approval", label: "Ready to deploy" },
    not_deployed: { variant: "neutral", label: "Not deployed" },
    training: { variant: "info", label: "Training" },
    scoring: { variant: "info", label: "Scoring" },
    failed: { variant: "destructive", label: "Failed" },
    deleting: { variant: "neutral", label: "Deleting" },
};

export function CardState({ state }: { state: string }) {
    const badge = STATES[state] ?? { variant: "neutral", label: state };
    return <Badge variant={badge.variant}>{badge.label}</Badge>;
}

export function scoreWord(card: ModelCard): string {
    const metric = card.evaluation.metric;
    return !metric || metric === "label_accuracy" ? "accuracy" : metricName(metric).toLowerCase();
}

export const KIND_NAMES: Record<string, string> = {
    lora: "Trained (LoRA)",
    prompt: "Prompt-only",
};

const USE_GROUPS: Record<string, { variant: Variant; label: string }> = {
    commercial: { variant: "success", label: "Commercial use allowed" },
    restricted: { variant: "warning", label: "Commercial use with conditions" },
    "non-commercial": { variant: "destructive", label: "Non-commercial only" },
    unknown: { variant: "neutral", label: "Not known" },
};

const CHECK_BADGES: Record<string, { variant: Variant; label: string }> = {
    ok: { variant: "success", label: "Passed" },
    warning: { variant: "warning", label: "Warning" },
    blocked: { variant: "destructive", label: "Blocked" },
    off: { variant: "neutral", label: "Off" },
    skipped: { variant: "neutral", label: "Skipped" },
};

const EVENT_BADGES: Record<string, { variant: Variant; label: string }> = {
    deployed: { variant: "success", label: "Deployed" },
    replaced: { variant: "neutral", label: "Replaced" },
    undeployed: { variant: "neutral", label: "Undeployed" },
};

const NONE = "–";

function warmupText(value: number | null | undefined): string {
    if (value === null || value === undefined) {
        return NONE;
    }
    return value === 0 ? "Off" : `${percent(value)} of steps`;
}

function scheduleText(value: string | null | undefined): string {
    return value ? (SCHEDULERS.find((item) => item.value === value)?.label ?? value) : NONE;
}

function when(value: string | null | undefined): string {
    return value ? exactTime(value) : NONE;
}

function Mono({ children }: { children: ReactNode }) {
    return <span className="font-mono break-words">{children}</span>;
}

function HashText({ children }: { children: ReactNode }) {
    return <span className="font-mono break-all">{children}</span>;
}

function Hash({ value, label }: { value: string | null | undefined; label: string }) {
    if (!value) {
        return <span className="text-muted-foreground">Not recorded</span>;
    }
    return (
        <span className="inline-flex max-w-full items-center gap-1">
            <HashText>{value}</HashText>
            <CopyButton value={value} label={`Copy ${label}`} />
        </span>
    );
}

function Subhead({ title, caption }: { title: string; caption?: string }) {
    return (
        <div className="flex flex-col gap-0.5 pt-2">
            <h3 className="text-base font-semibold">{title}</h3>
            {caption && <p className="text-sm text-muted-foreground">{caption}</p>}
        </div>
    );
}

function Panel({ children }: { children: ReactNode }) {
    return (
        <Card>
            <CardContent>{children}</CardContent>
        </Card>
    );
}

function Muted({ children }: { children: ReactNode }) {
    return <p className="text-muted-foreground">{children}</p>;
}

function Numeric({ value }: { value: string | number }) {
    return <span className="tabular-nums">{value}</span>;
}

function decimal(value: number | null | undefined): string {
    return value === null || value === undefined ? NONE : value.toFixed(3);
}

function seconds(value: number | null | undefined): string {
    if (value === null || value === undefined) {
        return NONE;
    }
    const minutes = Math.floor(value / 60);
    const rest = Math.round(value % 60);
    return minutes ? `${minutes} min ${rest} s` : `${rest} s`;
}

function points(amount: number): string {
    return deltaPoints(amount);
}

export function PurposeSection({ card }: { card: ModelCard }) {
    const purpose = card.purpose;
    return (
        <PanelSection
            anchor="purpose"
            icon={IconTarget}
            title="Purpose"
            description="What the model is for."
        >
            <Facts
                items={[
                    ["Description", purpose.description || "No description."],
                    ["Task", purpose.task.charAt(0).toUpperCase() + purpose.task.slice(1)],
                    [
                        purpose.labels.length > 1
                            ? `Labels (${count(purpose.labels.length)})`
                            : "Labels",
                        purpose.labels.length > 0 ? (
                            <LabelChips key="labels" labels={purpose.labels} />
                        ) : (
                            <span key="labels" className="text-muted-foreground">
                                {NO_DATA}
                            </span>
                        ),
                    ],
                ]}
            />
        </PanelSection>
    );
}

export function UseSection({ card, onEdit }: { card: ModelCard; onEdit?: () => void }) {
    return (
        <PanelSection
            anchor="use"
            icon={IconUser}
            title="Intended use and owner"
            description="Written by people; stored with this version and audited on every change."
            actions={
                onEdit && (
                    <Button variant="outline" onClick={onEdit}>
                        Edit
                    </Button>
                )
            }
        >
            <Facts
                items={[
                    [
                        "Intended use",
                        card.use.intended_use ? (
                            <span key="use" className="whitespace-pre-line">
                                {card.use.intended_use}
                            </span>
                        ) : (
                            <span key="use" className="text-muted-foreground">
                                Not written yet
                            </span>
                        ),
                    ],
                    ["Owner", card.use.owner],
                ]}
            />
        </PanelSection>
    );
}

function LicenceUse({ group }: { group: string }) {
    const badge = USE_GROUPS[group] ?? USE_GROUPS.unknown;
    return <Badge variant={badge.variant}>{badge.label}</Badge>;
}

export function BaseSection({ card }: { card: ModelCard }) {
    const base = card.base_model;
    const hashNote = base.content_hash_recorded
        ? "Recorded when training started; the adapter only loads on these files."
        : "From the base model's current files; a prompt-only version records no hash.";
    return (
        <PanelSection
            anchor="base-model"
            icon={IconCube}
            title="Base model"
            description="The weights this version runs on."
        >
            <Facts
                items={[
                    [
                        "Name",
                        <Link
                            key="name"
                            href={modelPageHref(base.key)}
                            className="text-primary hover:underline"
                        >
                            {base.name}
                        </Link>,
                    ],
                    ["Publisher", base.publisher ?? NONE],
                    ["Repository", base.repo ? <Mono key="repo">{base.repo}</Mono> : NONE],
                    [
                        "Revision",
                        base.revision ? <HashText key="rev">{base.revision}</HashText> : NONE,
                    ],
                    [
                        "Content hash",
                        <span key="hash" className="inline-flex flex-wrap items-center gap-1">
                            <Hash value={base.content_hash} label="content hash" />
                            {base.content_hash && (
                                <InfoTip label="About this hash">{hashNote}</InfoTip>
                            )}
                        </span>,
                    ],
                    ["Licence", base.licence_name ?? base.licence ?? NONE],
                    ["Commercial use", <LicenceUse key="use" group={base.licence_use} />],
                    [
                        "Licence accepted",
                        base.licence_accepted_by
                            ? `${base.licence_accepted_by}, ${when(base.licence_accepted_at)}`
                            : NONE,
                    ],
                ]}
            />
        </PanelSection>
    );
}

const BALANCE_COLUMNS: ListColumn<LabelRows>[] = [
    { header: "Label", value: (row) => row.label, render: (row) => <Mono>{row.label}</Mono> },
    {
        header: "Rows",
        value: (row) => row.rows,
        render: (row) => <Numeric value={count(row.rows)} />,
    },
    {
        header: "Share",
        value: (row) => row.share,
        render: (row) => <Numeric value={percent(row.share)} />,
    },
    {
        header: "Train",
        value: (row) => row.train,
        render: (row) => <Numeric value={count(row.train)} />,
    },
    {
        header: "Held-out",
        value: (row) => row.held_out,
        render: (row) => <Numeric value={count(row.held_out)} />,
    },
    {
        header: "Test",
        value: (row) => row.test,
        render: (row) => <Numeric value={count(row.test)} />,
    },
];

const SOURCE_COLUMNS: ColumnDef<Source, unknown>[] = [
    {
        header: "Table",
        accessorKey: "table",
        cell: (info) => <Mono>{String(info.getValue())}</Mono>,
    },
    { header: "Source", accessorFn: (source) => source.name ?? NONE },
    { header: "Kind", accessorFn: (source) => source.kind ?? NONE },
    {
        header: "Fingerprint",
        accessorKey: "fingerprint",
        enableSorting: false,
        cell: (info) => <HashText>{String(info.getValue())}</HashText>,
    },
];

function CheckList({ checks }: { checks: Check[] }) {
    if (checks.length === 0) {
        return <Muted>No checks were recorded with this data.</Muted>;
    }
    return (
        <ul className="flex flex-col divide-y">
            {checks.map((check) => {
                const badge = CHECK_BADGES[check.status] ?? CHECK_BADGES.skipped;
                return (
                    <li
                        key={check.check}
                        className="flex flex-wrap items-start gap-x-3 gap-y-1 py-2 first:pt-0 last:pb-0"
                    >
                        <span className="w-24 shrink-0">
                            <Badge variant={badge.variant}>{badge.label}</Badge>
                        </span>
                        <span className="min-w-0 flex-1">
                            <span className="font-semibold">{check.title}</span>
                            <span className="text-muted-foreground">{` · ${check.detail}`}</span>
                        </span>
                    </li>
                );
            })}
        </ul>
    );
}

function datasetVersion(data: Schemas["CardData"]): string {
    if (data.dataset_version === null || data.dataset_version === undefined) {
        return NONE;
    }
    const rows = data.dataset_version_feedback_rows ?? 0;
    return rows > 0
        ? `Version ${data.dataset_version}, plus ${count(rows)} ${rows === 1 ? "row" : "rows"} from feedback`
        : `Version ${data.dataset_version}`;
}

const DATA_TITLE = {
    anchor: "training-data",
    icon: IconDatabase,
    title: "Training data",
    description:
        "The dataset version this model version trained and scored on, with the checks run when it was saved.",
};

export function DataSection({ card }: { card: ModelCard }) {
    const data = card.training_data;
    if (!data) {
        return (
            <PanelSection {...DATA_TITLE}>
                <Muted>{NO_DATA}</Muted>
            </PanelSection>
        );
    }
    const splits = data.splits;
    const dataset = data.dataset_slug ? (
        <Link
            key="dataset"
            href={itemHref({ kind: "dataset", id: data.dataset_slug })}
            className="text-primary hover:underline"
        >
            {data.dataset_name ?? data.dataset_slug}
        </Link>
    ) : (
        NONE
    );
    return (
        <PanelSection {...DATA_TITLE} bare>
            <Panel>
                <Facts
                    items={[
                        ["Dataset", dataset],
                        ["Dataset version", datasetVersion(data)],
                        [
                            "SHA-256",
                            <Hash
                                key="dataset-version"
                                value={data.dataset_version_hash}
                                label="data hash"
                            />,
                        ],
                        ["Rows", <Numeric key="rows" value={count(data.dataset_version_rows)} />],
                        ["Saved", when(data.dataset_version_taken_at)],
                        [
                            "Splits",
                            <Numeric
                                key="splits"
                                value={`Train ${count(splits.train)} · held-out ${count(splits.held_out)} · test ${count(splits.test)} · few-shot ${count(splits.few_shot)}`}
                            />,
                        ],
                        [
                            "Personal data",
                            data.personal_data?.status === "warning" ? (
                                <span key="pii" className="text-warning">
                                    {data.personal_data.detail}
                                </span>
                            ) : (
                                (data.personal_data?.detail ?? "Not checked")
                            ),
                        ],
                    ]}
                />
            </Panel>
            <Subhead
                title="Label balance"
                caption={balanceCaption(data.label_balance?.length ?? 0)}
            />
            {data.label_balance ? (
                <EndsGrid
                    columns={BALANCE_COLUMNS}
                    rows={data.label_balance}
                    getRowId={(row) => row.label}
                    noun="labels"
                />
            ) : (
                <Muted>Not available: the data file could not be read.</Muted>
            )}
            <Subhead
                title="Sources"
                caption="Each source's fingerprint when the version was saved."
            />
            <DataGrid
                columns={SOURCE_COLUMNS}
                rows={data.sources}
                getRowId={(row) => row.table}
                empty="No source fingerprints were recorded with this data."
            />
            <Subhead title="Checks" />
            <Panel>
                <CheckList checks={data.checks} />
            </Panel>
        </PanelSection>
    );
}

function balanceCaption(labels: number): string {
    const base = "Usable rows per label in each split";
    return labels > FOLDED_LABELS
        ? `${base}: the 10 largest and the 10 smallest labels.`
        : `${base}.`;
}

function runFacts(run: Run | null | undefined): [string, ReactNode][] {
    if (!run) {
        return [["Job", "Not recorded"]];
    }
    return [
        ["Started", when(run.started_at)],
        ["Finished", when(run.finished_at)],
        ["Duration", <Numeric key="duration" value={seconds(run.duration_seconds)} />],
        ["Device", run.device ?? NONE],
        [
            "Pool",
            run.pool ? (
                <PoolLink key="pool" name={run.pool} machine={run.machine} />
            ) : run.machine ? (
                <Mono key="machine">{run.machine}</Mono>
            ) : (
                NONE
            ),
        ],
        ["Job", <Mono key="job">{`#${run.job_id}`}</Mono>],
    ];
}

export function TrainingSection({ card }: { card: ModelCard }) {
    const training = card.training;
    const recipe = training.recipe;
    const origin = training.duplicated_from;
    const copied: [string, ReactNode][] = origin
        ? [
              [
                  "Duplicated from",
                  <Link
                      key="origin"
                      href={modelPageHref(origin.slug, "versions")}
                      className="text-primary hover:underline"
                  >
                      {`${origin.name} v${origin.number}`}
                  </Link>,
              ],
          ]
        : [];
    if (training.method !== "lora" || !recipe) {
        return (
            <PanelSection
                anchor="training"
                icon={IconCpu}
                title="Training"
                description="How the version was built."
            >
                <p>
                    {`Prompt-only: no weights were trained. The base model answers with the task prompt, the label list and ${training.few_shot_examples ?? 0} few-shot examples from the training split.`}
                </p>
                {origin && <Facts items={copied} />}
            </PanelSection>
        );
    }
    const value = (item: number | null | undefined) => <Numeric value={item ?? NONE} />;
    return (
        <PanelSection
            anchor="training"
            icon={IconCpu}
            title="Training"
            description="How the version was built."
        >
            <Facts
                items={[
                    ...copied,
                    ["Method", "LoRA adapter"],
                    ["Strategy", recipe.strategy ?? NONE],
                    ["Rows trained on", value(training.examples)],
                    ["Epochs", value(recipe.epochs)],
                    [
                        "LoRA rank and alpha",
                        <Numeric
                            key="lora"
                            value={`${recipe.rank ?? NONE} and ${recipe.alpha ?? NONE}`}
                        />,
                    ],
                    ["LoRA dropout", value(recipe.dropout)],
                    ["Learning rate", value(recipe.learning_rate)],
                    ["Warmup", warmupText(recipe.warmup)],
                    ["Schedule", scheduleText(recipe.scheduler)],
                    ["Weight decay", value(recipe.weight_decay)],
                    ["Sequence length", value(recipe.seq_len)],
                    [
                        "Batch size",
                        <Numeric
                            key="batch"
                            value={`${recipe.micro_batch ?? NONE} × ${recipe.grad_accum ?? NONE} accumulation`}
                        />,
                    ],
                    ["Final training loss", value(training.train_loss)],
                    ...runFacts(training.run),
                ]}
            />
        </PanelSection>
    );
}

type Compared = { id: string; header: string; comparison: Comparison };

function comparedVersions(card: ModelCard): Compared[] {
    const baseline = card.evaluation.prompt_only;
    const previous = card.evaluation.previous;
    const found: Compared[] = [];
    if (baseline) {
        found.push({
            id: "prompt",
            header: `Prompt-only v${baseline.number}`,
            comparison: baseline,
        });
    }
    if (previous && previous.number !== baseline?.number) {
        found.push({
            id: "previous",
            header: `Previous v${previous.number}`,
            comparison: previous,
        });
    }
    return found;
}

type Metric = {
    id: string;
    label: string;
    mine: number | null | undefined;
    pick: (comparison: Comparison) => number | null | undefined;
    show: (value: number | null | undefined) => string;
    better: "higher" | "lower";
};

function metricRow(metric: Metric, others: Compared[]): CompareRow {
    const entries = [
        { key: "this", value: metric.mine },
        ...others.map((other) => ({ key: other.id, value: metric.pick(other.comparison) })),
    ];
    const values = entries.map((entry) => entry.value);
    return {
        id: metric.id,
        label: metric.label,
        cells: entries.map((entry) => <Numeric key={entry.key} value={metric.show(entry.value)} />),
        values,
        differs: new Set(values.map(String)).size > 1,
        formatDelta: metric.show === percent ? points : undefined,
        better: metric.better,
    };
}

function metrics(card: ModelCard): Metric[] {
    const evaluation = card.evaluation;
    const word = scoreWord(card);
    return [
        {
            id: "accuracy",
            label: `Held-out ${word}`,
            mine: evaluation.held_out?.accuracy,
            pick: (other) => other.held_out_accuracy,
            show: percent,
            better: "higher",
        },
        {
            id: "f1",
            label: "Held-out macro F1",
            mine: evaluation.held_out?.macro_f1,
            pick: (other) => other.held_out_macro_f1,
            show: decimal,
            better: "higher",
        },
        {
            id: "test",
            label: `Test set ${word}`,
            mine: evaluation.test_set?.accuracy,
            pick: (other) => other.test_accuracy,
            show: percent,
            better: "higher",
        },
        {
            id: "p50",
            label: "Latency p50",
            mine: evaluation.latency_p50_ms,
            pick: (other) => other.latency_p50_ms,
            show: milliseconds,
            better: "lower",
        },
        {
            id: "p95",
            label: "Latency p95",
            mine: evaluation.latency_p95_ms,
            pick: (other) => other.latency_p95_ms,
            show: milliseconds,
            better: "lower",
        },
    ];
}

function costRow(card: ModelCard, others: Compared[]): CompareRow {
    const costs = [card.evaluation.cost, ...others.map((other) => other.comparison.cost)];
    const currency = costs.find((cost) => cost?.currency)?.currency;
    const allPriced = Boolean(currency) && costs.every((cost) => cost?.per_1m != null);
    const values = costs.map((cost) =>
        cost ? (allPriced ? cost.per_1m : cost.device_seconds_per_1m) : null,
    );
    return {
        id: "cost",
        label: allPriced ? "Cost / 1M tokens" : "GPU time / 1M tokens",
        cells: costs.map((cost, index) => (
            <Numeric
                key={index === 0 ? "this" : others[index - 1]?.id}
                value={allPriced ? costText(cost) : deviceTime(cost)}
            />
        )),
        values,
        differs: new Set(values.map(String)).size > 1,
        formatDelta:
            allPriced && currency
                ? (amount) => money(amount, currency)
                : (amount) => duration(amount),
        better: "lower",
    };
}

function ComparisonTable({ card }: { card: ModelCard }) {
    const others = comparedVersions(card);
    if (others.length === 0) {
        return <Muted>No earlier scored version to compare with.</Muted>;
    }
    const theirs = others.map((other) => other.comparison);
    const columns: CompareColumn[] = [
        { id: "this", header: `This version (v${card.version.number})`, label: "This version" },
        ...others.map((other) => ({ id: other.id, header: other.header, label: other.header })),
    ];
    const rows: CompareRow[] = [
        {
            id: "kind",
            label: "Kind",
            cells: [card.version.kind, ...theirs.map((other) => other.kind)].map(
                (kind) => KIND_NAMES[kind] ?? kind,
            ),
        },
        {
            id: "data",
            label: "Data",
            cells: [
                "This data",
                ...theirs.map((other) => (other.same_data ? "Same data" : "Other data")),
            ],
        },
        ...metrics(card).map((metric) => metricRow(metric, others)),
        costRow(card, others),
    ];
    return (
        <CompareTable
            label="Comparison with earlier versions"
            columns={columns}
            sections={[{ id: "scores", rows }]}
            baseline="this"
            columnWidth="11rem"
        />
    );
}

const LABEL_COLUMNS: ListColumn<LabelScore>[] = [
    { header: "Label", value: (row) => row.label, render: (row) => <Mono>{row.label}</Mono> },
    {
        header: "Held-out rows",
        value: (row) => row.support,
        render: (row) => <Numeric value={count(row.support)} />,
    },
    {
        header: "Predicted",
        value: (row) => row.predicted,
        render: (row) => <Numeric value={count(row.predicted)} />,
    },
    {
        header: "Precision",
        value: (row) => row.precision ?? -1,
        render: (row) => <Numeric value={percent(row.precision)} />,
    },
    {
        header: "Recall",
        value: (row) => row.recall ?? -1,
        render: (row) => <Numeric value={percent(row.recall)} />,
    },
    {
        header: "F1",
        value: (row) => row.f1 ?? -1,
        render: (row) => <Numeric value={decimal(row.f1)} />,
    },
];

function bySupport(scores: LabelScore[]): LabelScore[] {
    return [...scores].sort((a, b) => b.support - a.support || a.label.localeCompare(b.label));
}

const CONFUSION_COLUMNS: ColumnDef<Confusion, unknown>[] = [
    {
        header: "Expected",
        accessorKey: "expected",
        cell: (info) => <Mono>{String(info.getValue())}</Mono>,
    },
    {
        header: "Answered",
        accessorFn: (item) => item.predicted ?? "",
        cell: (info) =>
            info.row.original.predicted ? (
                <Mono>{info.row.original.predicted}</Mono>
            ) : (
                <span className="text-muted-foreground">Not a label</span>
            ),
    },
    {
        header: "Rows",
        accessorKey: "count",
        cell: (info) => <Numeric value={count(info.row.original.count)} />,
    },
];

function confusionKey(item: Confusion): string {
    return `${item.expected}→${item.predicted ?? ""}`;
}

function cardHeadline(card: ModelCard): string | null {
    const baseline = card.evaluation.prompt_only;
    if (!baseline) {
        return null;
    }
    return headline(
        { number: baseline.number, score: baseline.held_out_accuracy, cost: baseline.cost },
        {
            number: card.version.number,
            score: card.evaluation.held_out?.accuracy,
            cost: card.evaluation.cost,
        },
    );
}

const EVALUATION_TITLE = {
    anchor: "evaluation",
    icon: IconGauge,
    title: "Evaluation",
    description: "Scores on rows the model never trained on: the held-out split and the test set.",
};

function Confusions({ rows }: { rows: Confusion[] }) {
    const folded = useFolded(rows);
    return (
        <div className="flex flex-col gap-1.5">
            <DataGrid
                columns={CONFUSION_COLUMNS}
                rows={folded.rows}
                getRowId={confusionKey}
                empty="Every held-out row was answered correctly."
            />
            {folded.toggle}
        </div>
    );
}

export function EvaluationSection({ card }: { card: ModelCard }) {
    if (!card.training_data) {
        return (
            <PanelSection {...EVALUATION_TITLE}>
                <Muted>{NO_DATA}</Muted>
            </PanelSection>
        );
    }
    return <Evaluation card={card} />;
}

function Evaluation({ card }: { card: ModelCard }) {
    const evaluation = card.evaluation;
    const held = evaluation.held_out;
    const summary = cardHeadline(card);
    const labels = evaluation.per_label ?? [];
    return (
        <PanelSection {...EVALUATION_TITLE} bare>
            <Panel>
                {!evaluation.scored && <p className="pb-3 text-warning">Not scored yet.</p>}
                {summary && <p className="pb-3 text-base font-semibold tabular-nums">{summary}</p>}
                <div className="flex flex-wrap gap-x-8 gap-y-4">
                    <Stat label="Held-out rows" value={count(held?.examples)} />
                    <Stat label={`Held-out ${scoreWord(card)}`} value={percent(held?.accuracy)} />
                    <Stat label="Macro F1" value={decimal(held?.macro_f1)} />
                    <Stat label="Not a label" value={percent(held?.invalid_rate)} />
                    <Stat label="Test set" value={percent(evaluation.test_set?.accuracy)} />
                    <Stat label="p50" value={milliseconds(evaluation.latency_p50_ms)} />
                    <Stat label="p95" value={milliseconds(evaluation.latency_p95_ms)} />
                    <Stat label="GPU time / 1M tokens" value={deviceTime(evaluation.cost)} />
                    {priced(evaluation.cost) && (
                        <Stat label="Cost / 1M tokens" value={costText(evaluation.cost)} />
                    )}
                </div>
                {evaluation.cost?.device_name && (
                    <p className="pt-3 text-sm text-muted-foreground">
                        {measuredOn(evaluation.cost)}
                    </p>
                )}
                <div className="pt-4">
                    <Facts items={runFacts(evaluation.run)} />
                </div>
            </Panel>
            <Subhead
                title="Comparison"
                caption="Against the latest earlier prompt-only version and the version before."
            />
            <ComparisonTable card={card} />
            <Subhead
                title="Per label"
                caption={
                    labels.length > FOLDED_LABELS
                        ? "Held-out precision, recall and F1: the 10 labels with the most held-out rows and the 10 with the fewest."
                        : "Held-out precision, recall and F1 for each label."
                }
            />
            {evaluation.per_label ? (
                <EndsGrid
                    columns={LABEL_COLUMNS}
                    rows={bySupport(labels)}
                    getRowId={(item) => item.label}
                    noun="labels"
                />
            ) : (
                <Muted>Per-label scores were not recorded for this version.</Muted>
            )}
            <Subhead
                title="Confusions"
                caption="Held-out rows answered with the wrong label, most frequent first."
            />
            {evaluation.confusion ? (
                <Confusions rows={evaluation.confusion} />
            ) : (
                <Muted>Confusions were not recorded for this version.</Muted>
            )}
        </PanelSection>
    );
}

const LONG_LIMIT = 12;

function LimitLine({ limit }: { limit: ModelCard["limits"]["derived"][number] }) {
    const [open, setOpen] = useState(false);
    const labels = limit.labels ?? [];
    const long = labels.length > LONG_LIMIT;
    return (
        <li>
            <span className={long && !open ? "line-clamp-2" : undefined}>{limit.text}</span>
            {long && <ShowAll open={open} total={labels.length} onToggle={() => setOpen(!open)} />}
        </li>
    );
}

export function LimitsSection({ card, onEdit }: { card: ModelCard; onEdit?: () => void }) {
    const derived = card.limits.derived;
    return (
        <PanelSection
            anchor="limits"
            icon={IconAlertTriangle}
            title="Limits"
            description="Facts read from the data and scores, then what people know beyond them."
            actions={
                onEdit && (
                    <Button variant="outline" onClick={onEdit}>
                        Edit known limits
                    </Button>
                )
            }
        >
            <div className="flex flex-col gap-4">
                <div className="flex flex-col gap-1.5">
                    <h3 className="font-semibold">From the data and scores</h3>
                    {derived.length === 0 ? (
                        <Muted>None found.</Muted>
                    ) : (
                        <ul className="flex list-disc flex-col gap-1 pl-5">
                            {derived.map((limit) => (
                                <LimitLine key={limit.kind} limit={limit} />
                            ))}
                        </ul>
                    )}
                </div>
                <div className="flex flex-col gap-1.5">
                    <h3 className="font-semibold">Known limits</h3>
                    {card.limits.known_limits ? (
                        <p className="whitespace-pre-line">{card.limits.known_limits}</p>
                    ) : (
                        <Muted>None written.</Muted>
                    )}
                </div>
            </div>
        </PanelSection>
    );
}

const EVENT_COLUMNS: ColumnDef<CardEvent, unknown>[] = [
    {
        header: "When",
        id: "at",
        accessorFn: (event) => Date.parse(event.at),
        cell: (info) => <span className="tabular-nums">{when(info.row.original.at)}</span>,
    },
    { header: "Who", accessorKey: "actor" },
    {
        header: "Event",
        accessorKey: "summary",
        cell: ({ row }) => {
            const badge = EVENT_BADGES[row.original.kind] ?? EVENT_BADGES.replaced;
            return (
                <span className="flex flex-wrap items-center gap-2">
                    <Badge variant={badge.variant}>{badge.label}</Badge>
                    {row.original.summary}
                </span>
            );
        },
    },
    {
        header: "Audit event",
        accessorKey: "audit_id",
        cell: ({ row }) => (
            <Link
                href={auditHref({ event: String(row.original.audit_id) })}
                className="font-mono text-primary hover:underline"
            >
                {`#${row.original.audit_id}`}
            </Link>
        ),
    },
];

function approvalText(card: ModelCard): string {
    const approvals = card.approvals;
    if (approvals.length === 0) {
        return "Not deployed: the audit log records no deployment of this version.";
    }
    const last = approvals[approvals.length - 1];
    const times = approvals.length === 1 ? "" : `, ${approvals.length} times in all`;
    return `Put live by ${last.actor} on ${when(last.at)}${times}.`;
}

export function ApprovalsSection({ card }: { card: ModelCard }) {
    const folded = useFolded(card.deployments, "end");
    return (
        <PanelSection
            anchor="deployments"
            icon={IconShieldCheck}
            title="Approvals and deployments"
            description={approvalText(card)}
            bare
        >
            <DataGrid
                columns={EVENT_COLUMNS}
                rows={folded.rows}
                getRowId={(event) => String(event.audit_id)}
                empty="No deployment changes recorded in the audit log."
            />
            {folded.toggle}
        </PanelSection>
    );
}

export function IntegritySection({ sha256, form }: { sha256: string; form: string | undefined }) {
    return (
        <PanelSection
            anchor="integrity"
            icon={IconFingerprint}
            title="Integrity"
            description="The Markdown and JSON downloads carry this digest, so a reviewer can check the card was not changed."
        >
            <div className="flex flex-wrap items-center gap-2">
                <span className="text-muted-foreground">SHA-256 of the canonical JSON</span>
                {form && <InfoTip label="How the digest is computed">{form}</InfoTip>}
                <Hash value={sha256} label="card digest" />
            </div>
        </PanelSection>
    );
}
