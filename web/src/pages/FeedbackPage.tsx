import { IconPlayerPlay } from "@tabler/icons-react";
import type { ColumnDef } from "@tanstack/react-table";
import {
    Badge,
    Button,
    CheckboxSelect,
    DataGrid,
    Link,
    SearchInput,
    Tabs,
    TabsList,
    TabsTrigger,
    cn,
} from "obp-ui";
import { type ReactNode, useEffect, useMemo } from "react";
import {
    type FeedbackInfo,
    useFeedbackFacets,
    useFeedbackItem,
    useFeedbackList,
} from "~/api/feedbackQueries";
import { useModels } from "~/api/queries";
import { PageHeader } from "~/components/PageHeader";
import { modelOption } from "~/components/PublisherLogo";
import { ErrorLine, Page } from "~/components/Section";
import { StatusText } from "~/components/models/StatusText";
import {
    FEEDBACK_PATH,
    FEEDBACK_STATUSES,
    FEEDBACK_TABS,
    type FeedbackTab,
    feedbackStatusLabel,
    feedbackStatusVariant,
    feedbackTab,
    fromLabel,
    signalLabel,
    tabLabel,
} from "~/lib/feedback";
import { listHref, splitList, useListSearch } from "~/lib/listSearch";
import { DiffText, answerDiff } from "./feedback/AnswerDiff";
import { FeedbackReview } from "./feedback/FeedbackReview";
import { TrainingNudges } from "./feedback/TrainingNudges";
import { Updated } from "./models/MyModels";

const KEYS = ["model", "status", "assignee", "q", "item"] as const;
const ASSIGNEES = [
    { value: "me", label: "Me" },
    { value: "none", label: "No one" },
];

const STATUS_WIDTH = 264;
const NEXT = "next";

const EMPTY: Record<FeedbackTab, string> = {
    pending: "Nothing to review. New feedback lands here.",
    accepted: "No accepted feedback yet.",
    rejected: "No rejected feedback.",
    all: "",
};

function Muted({ children }: { children: string }) {
    return <span className="text-muted-foreground">{children}</span>;
}

function TextCell({
    text,
    wide = false,
    children,
}: { text: string; wide?: boolean; children?: ReactNode }) {
    return (
        <span
            className={cn(
                "grid",
                wide ? "grid-cols-[minmax(10rem,1fr)]" : "grid-cols-[minmax(8rem,1fr)]",
            )}
        >
            <span className="max-w-[32rem] truncate" title={text}>
                {children ?? text}
            </span>
        </span>
    );
}

function ReviewHeader({ id, back }: { id: number | null; back: string }) {
    const item = useFeedbackItem(id);
    const model = item.data?.model_name;
    return (
        <PageHeader
            title="Review feedback"
            crumbs={[{ label: "Feedback", href: back }, { label: id === null ? "Next" : `#${id}` }]}
            caption={
                model
                    ? `An answer from ${model}. Accept it, edit it or reject it.`
                    : "Accept the answer, edit it or reject it."
            }
        />
    );
}

export function FeedbackStatusBadge({ item }: { item: FeedbackInfo }) {
    return (
        <Badge variant={feedbackStatusVariant(item.status)}>
            {feedbackStatusLabel(item.status)}
        </Badge>
    );
}

function StatusCell({ item }: { item: FeedbackInfo }) {
    const signal = signalLabel(item.signal);
    return (
        <span className="flex min-w-0 items-center gap-2" title={signal ?? undefined}>
            <FeedbackStatusBadge item={item} />
            {signal && (
                <span className="min-w-0 truncate">
                    <StatusText tone={item.signal === "conflict" ? "warning" : "info"}>
                        {signal}
                    </StatusText>
                </span>
            )}
        </span>
    );
}

function AnswerCell({ item }: { item: FeedbackInfo }) {
    if (!item.output) {
        return <Muted>Not sent</Muted>;
    }
    const parts = answerDiff(item);
    return (
        <TextCell text={item.output}>
            {parts ? <DiffText parts={parts} side="before" /> : null}
        </TextCell>
    );
}

function SuggestionCell({ item }: { item: FeedbackInfo }) {
    if (!item.suggestion) {
        return <Muted>None given</Muted>;
    }
    const parts = answerDiff(item);
    return (
        <TextCell text={item.suggestion}>
            {parts ? <DiffText parts={parts} side="after" /> : null}
        </TextCell>
    );
}

function feedbackColumns(href: (item: FeedbackInfo) => string): ColumnDef<FeedbackInfo, unknown>[] {
    return [
        {
            id: "input",
            header: "Input",
            enableHiding: false,
            cell: ({ row }) => (
                <Link href={href(row.original)} className="font-semibold text-foreground">
                    <TextCell text={row.original.input} wide />
                </Link>
            ),
        },
        {
            id: "answer",
            header: "Model's answer",
            cell: ({ row }) => <AnswerCell item={row.original} />,
        },
        {
            id: "suggestion",
            header: "Suggested answer",
            cell: ({ row }) => <SuggestionCell item={row.original} />,
        },
        {
            id: "status",
            header: "Status",
            size: STATUS_WIDTH,
            enableResizing: false,
            cell: ({ row }) => <StatusCell item={row.original} />,
        },
        {
            id: "model",
            header: "Model",
            cell: ({ row }) => (
                <span className="block max-w-48 truncate">{row.original.model_name}</span>
            ),
        },
        {
            id: "assignee",
            header: "Assigned to",
            cell: ({ row }) =>
                row.original.assignee ? (
                    <span className="block truncate">{row.original.assignee}</span>
                ) : (
                    <Muted>No one</Muted>
                ),
        },
        {
            id: "origin",
            header: "From",
            cell: ({ row }) => fromLabel(row.original),
        },
        {
            id: "version",
            header: "Version",
            cell: ({ row }) => (
                <span className="tabular-nums">
                    {row.original.version === null ? "–" : `v${row.original.version}`}
                </span>
            ),
        },
        {
            id: "received",
            header: "Received",
            cell: ({ row }) => <Updated value={row.original.created_at} />,
        },
    ];
}

function itemId(value: string | undefined): number | null {
    const id = Number(value);
    return value && Number.isInteger(id) && id > 0 ? id : null;
}

function StatusTabs({
    value,
    counts,
    onChange,
}: {
    value: FeedbackTab;
    counts: Record<string, number> | undefined;
    onChange: (tab: FeedbackTab) => void;
}) {
    const total = FEEDBACK_STATUSES.reduce((sum, status) => sum + (counts?.[status] ?? 0), 0);
    return (
        <Tabs value={value} onValueChange={(next) => onChange(next as FeedbackTab)}>
            <TabsList aria-label="Feedback status">
                {FEEDBACK_TABS.map((tab) => (
                    <TabsTrigger key={tab} value={tab}>
                        {tabLabel(tab)}
                        {counts && (
                            <span className="text-sm tabular-nums text-muted-foreground">
                                {(tab === "all" ? total : (counts[tab] ?? 0)).toLocaleString()}
                            </span>
                        )}
                    </TabsTrigger>
                ))}
            </TabsList>
        </Tabs>
    );
}

function NoFeedback() {
    return (
        <p className="text-muted-foreground">
            No feedback yet. Mark answers in the{" "}
            <Link href="/playground" className="text-primary hover:underline">
                Playground
            </Link>{" "}
            or send them with <span className="font-mono">POST /v1/feedback</span>.
        </p>
    );
}

export function FeedbackPage() {
    const { search, update, open } = useListSearch(FEEDBACK_PATH, KEYS);
    const owned = useModels();
    const tab = feedbackTab(search.status);
    const models = splitList(search.model);
    const assignees = splitList(search.assignee);
    const filter = {
        model: models,
        status: tab === "all" ? [] : [tab],
        assignee: assignees,
        q: search.q,
    };
    const list = useFeedbackList(filter);
    const facets = useFeedbackFacets(filter);
    const selected = itemId(search.item);
    const filtering = models.length + assignees.length > 0 || Boolean(search.q);
    const columns = useMemo(
        () =>
            feedbackColumns((item) =>
                listHref(FEEDBACK_PATH, { ...search, item: String(item.id) }),
            ),
        [search],
    );
    const ids = list.rows.map((item) => item.id);
    const pending = facets.data?.statuses.pending ?? 0;
    const first = tab === "pending" && !list.isPlaceholder ? list.rows[0] : undefined;
    const clear = () => update({ model: "", assignee: "", q: "" });
    const show = (id: number | null) =>
        id === null ? update({ item: "" }) : open({ item: String(id) });
    const reviewNext = () => open({ status: "", item: first ? String(first.id) : NEXT });
    const waiting = search.item === NEXT;
    useEffect(() => {
        if (search.item !== NEXT || tab !== "pending" || list.isPlaceholder || list.isLoading) {
            return;
        }
        update({ item: list.rows[0] ? String(list.rows[0].id) : "" });
    }, [search.item, tab, list.isPlaceholder, list.isLoading, list.rows, update]);
    const modelOptions = (owned.data ?? []).map((item) =>
        modelOption({
            value: item.key,
            label: item.name,
            count: facets.data?.models[item.key] ?? 0,
        }),
    );
    if (waiting) {
        return (
            <Page>
                <ReviewHeader id={null} back={listHref(FEEDBACK_PATH, { ...search, item: "" })} />
            </Page>
        );
    }
    if (selected !== null) {
        return (
            <Page>
                <ReviewHeader
                    id={selected}
                    back={listHref(FEEDBACK_PATH, { ...search, item: "" })}
                />
                <FeedbackReview
                    key={selected}
                    id={selected}
                    ids={ids}
                    total={list.total}
                    hasMore={list.hasMore}
                    loadMore={list.loadMore}
                    onOpen={show}
                />
            </Page>
        );
    }
    return (
        <Page wide>
            <PageHeader
                title="Feedback"
                caption="Answers people marked right or wrong, from the playground and the API. Accepted answers join the model's next training data."
                actions={
                    <Button onClick={reviewNext} disabled={pending === 0}>
                        <IconPlayerPlay aria-hidden="true" />
                        Review next
                    </Button>
                }
            />
            <TrainingNudges models={models} />
            <StatusTabs
                value={tab}
                counts={facets.data?.statuses}
                onChange={(next) => update({ status: next === "pending" ? "" : next })}
            />
            <div className="flex flex-wrap items-center gap-2">
                <SearchInput
                    aria-label="Search feedback"
                    placeholder="Search inputs, answers and comments"
                    value={search.q ?? ""}
                    onValueChange={(q) => update({ q })}
                    className="w-full min-w-48 max-w-xs flex-1"
                />
                <CheckboxSelect
                    label="Model"
                    allLabel="All models"
                    noun="models"
                    options={modelOptions}
                    value={models}
                    onValueChange={(next) => update({ model: next.join(",") })}
                />
                <CheckboxSelect
                    label="Assigned to"
                    allLabel="Anyone"
                    noun="people"
                    options={ASSIGNEES}
                    value={assignees}
                    onValueChange={(next) => update({ assignee: next.join(",") })}
                />
                {filtering && (
                    <Button variant="ghost" onClick={clear}>
                        Clear filters
                    </Button>
                )}
            </div>
            <ErrorLine error={list.error} />
            <DataGrid
                columns={columns}
                rows={list.rows}
                getRowId={(item) => String(item.id)}
                loading={list.isLoading}
                sortable={false}
                storageKey="minibrain.feedback.columns"
                columnPicker
                hiddenColumns={["assignee", "origin", "version", "received"]}
                hasMore={list.hasMore}
                loadingMore={list.loadingMore}
                onLoadMore={list.loadMore}
                total={list.total}
                onOpen={(item) => show(item.id)}
                rowLabel={(item) =>
                    `${item.input}, ${item.model_name}, ${feedbackStatusLabel(item.status)}`
                }
                empty={
                    filtering ? (
                        <p className="text-muted-foreground">No feedback matches these filters.</p>
                    ) : tab === "all" ? (
                        <NoFeedback />
                    ) : (
                        <p className="text-muted-foreground">{EMPTY[tab]}</p>
                    )
                }
                minWidth="min-w-[880px]"
            />
        </Page>
    );
}
