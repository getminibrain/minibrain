import {
    IconArrowLeft,
    IconCheck,
    IconPencil,
    IconPlayerSkipForward,
    IconThumbDown,
    IconThumbUp,
    IconX,
} from "@tabler/icons-react";
import {
    Badge,
    Button,
    Card,
    CardContent,
    Kbd,
    KbdHint,
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
    Textarea,
    useToast,
} from "obp-ui";
import { type ReactNode, useEffect, useRef, useState } from "react";
import {
    type FeedbackDetail,
    type FeedbackInfo,
    useAssign,
    useFeedbackItem,
    usePrefetchFeedback,
    useReview,
} from "~/api/feedbackQueries";
import { NotFoundState, QueryError } from "~/components/ErrorState";
import { ErrorLine } from "~/components/Section";
import { When } from "~/components/When";
import { StatusText } from "~/components/models/StatusText";
import {
    feedbackStatusLabel,
    feedbackStatusVariant,
    originLabel,
    ratingLabel,
    signalLabel,
} from "~/lib/feedback";
import { count } from "~/lib/format";
import { relativeTime } from "~/lib/time";
import { DiffText, answerDiff } from "./AnswerDiff";

type Props = {
    id: number;
    ids: number[];
    total: number | undefined;
    hasMore: boolean;
    loadMore: () => void;
    onOpen: (id: number | null) => void;
};

type Decision = "accept" | "reject";

const KNOWN = "known";
const PANE =
    "max-h-[40vh] min-h-24 overflow-y-auto whitespace-pre-wrap break-words rounded-md border p-3";

function typing(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) {
        return false;
    }
    return (
        target.isContentEditable ||
        ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) ||
        target.closest("[role=listbox],[role=menu],[role=dialog]") !== null
    );
}

function Column({
    label,
    aside,
    children,
}: {
    label: string;
    aside?: ReactNode;
    children: ReactNode;
}) {
    return (
        <section className="flex min-w-0 flex-col gap-label">
            <div className="flex h-7 items-center justify-between gap-2">
                <h3 className="text-sm text-muted-foreground">{label}</h3>
                {aside}
            </div>
            {children}
        </section>
    );
}

function Pane({ children, muted = false }: { children: ReactNode; muted?: boolean }) {
    return <div className={muted ? `${PANE} text-muted-foreground` : PANE}>{children}</div>;
}

function senderText(item: FeedbackDetail): string {
    const key = item.key_name ?? item.request?.key_name;
    if (item.held_out) {
        return `${item.sent_by ?? "Someone"} saved it as a test example in the Playground`;
    }
    if (item.sent_by) {
        return `${item.sent_by}, from the ${originLabel(item.origin)}`;
    }
    return key ? `The API key ${key}` : `From the ${originLabel(item.origin)}`;
}

function Sender({ item }: { item: FeedbackDetail }) {
    return (
        <p className="flex flex-wrap items-center gap-x-1.5 text-sm text-muted-foreground">
            <span>{senderText(item)}</span>
            <span aria-hidden="true">·</span>
            <When value={item.created_at} />
            {item.version !== null && (
                <>
                    <span aria-hidden="true">·</span>
                    <span className="tabular-nums">{`answered by v${item.version}`}</span>
                </>
            )}
        </p>
    );
}

function relatedText(item: FeedbackInfo): string {
    if (item.status === "accepted") {
        return item.label ?? "";
    }
    if (item.suggestion) {
        return item.suggestion;
    }
    return item.output ? `${item.output} marked wrong` : "Marked wrong, no right answer given";
}

function Related({ items, onOpen }: { items: FeedbackInfo[]; onOpen: (id: number) => void }) {
    if (items.length === 0) {
        return null;
    }
    return (
        <Column label={`Other feedback on the same input (${items.length})`}>
            <ul className="flex flex-col divide-y rounded-md border">
                {items.map((other) => (
                    <li key={other.id} className="flex flex-wrap items-center gap-2 px-3 py-1.5">
                        <Button
                            variant="link"
                            className="h-auto min-w-0 flex-1 justify-start truncate px-0 font-normal text-foreground"
                            onClick={() => onOpen(other.id)}
                        >
                            {relatedText(other)}
                        </Button>
                        <Badge variant={feedbackStatusVariant(other.status)}>
                            {feedbackStatusLabel(other.status)}
                        </Badge>
                        <When value={other.created_at} className="text-sm text-muted-foreground" />
                    </li>
                ))}
            </ul>
        </Column>
    );
}

function RatingBadge({ item }: { item: FeedbackDetail }) {
    const Icon = item.rating === "up" ? IconThumbUp : IconThumbDown;
    return (
        <Badge variant={item.rating === "up" ? "success" : "warning"}>
            <Icon aria-hidden="true" />
            {ratingLabel(item.rating)}
        </Badge>
    );
}

function ModelAnswer({ item }: { item: FeedbackDetail }) {
    const parts = answerDiff(item);
    return (
        <Column label="Model's answer" aside={<RatingBadge item={item} />}>
            {item.output ? (
                <Pane>{parts ? <DiffText parts={parts} side="before" /> : item.output}</Pane>
            ) : (
                <Pane muted>Not sent with the feedback</Pane>
            )}
        </Column>
    );
}

function Suggestion({ item }: { item: FeedbackDetail }) {
    const parts = answerDiff(item);
    return (
        <Column label="Suggested answer">
            {item.suggestion ? (
                <Pane>{parts ? <DiffText parts={parts} side="after" /> : item.suggestion}</Pane>
            ) : (
                <Pane muted>None given. Edit the answer to give the right one.</Pane>
            )}
        </Column>
    );
}

function AnswerEditor({
    item,
    value,
    onChange,
    onSubmit,
    onCancel,
    fieldRef,
}: {
    item: FeedbackDetail;
    value: string;
    onChange: (value: string) => void;
    onSubmit: () => void;
    onCancel: () => void;
    fieldRef: React.RefObject<HTMLTextAreaElement | null>;
}) {
    return (
        <Column
            label="Right answer"
            aside={
                item.labels.length > 0 && (
                    <Select
                        value={item.labels.includes(value) ? value : KNOWN}
                        onValueChange={(next) => next && next !== KNOWN && onChange(String(next))}
                    >
                        <SelectTrigger aria-label="Pick a known answer" size="sm" className="w-44">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value={KNOWN} disabled>
                                Pick a known answer
                            </SelectItem>
                            {item.labels.map((label) => (
                                <SelectItem key={label} value={label}>
                                    {label}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                )
            }
        >
            <Textarea
                ref={fieldRef}
                aria-label="Right answer"
                value={value}
                onChange={(event) => onChange(event.target.value)}
                onKeyDown={(event) => {
                    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                        event.preventDefault();
                        onSubmit();
                    } else if (event.key === "Escape") {
                        event.preventDefault();
                        onCancel();
                    }
                }}
                placeholder="Type the right answer"
                className="min-h-24 max-h-[40vh]"
            />
        </Column>
    );
}

function reviewedText(item: FeedbackDetail): string | null {
    if (item.status === "pending" || !item.reviewed_by) {
        return null;
    }
    const when = item.reviewed_at ? `, ${relativeTime(item.reviewed_at)}` : "";
    return `by ${item.reviewed_by}${when}`;
}

function leftText(index: number, total: number | undefined): string | null {
    if (index < 0 || total === undefined) {
        return null;
    }
    return `${count(Math.max(total - index, 1))} left`;
}

function Review({ item, ids, total, hasMore, loadMore, onOpen }: Props & { item: FeedbackDetail }) {
    const toast = useToast();
    const review = useReview();
    const assign = useAssign();
    const prefetch = usePrefetchFeedback();
    const field = useRef<HTMLTextAreaElement>(null);
    const [editing, setEditing] = useState(false);
    const [answer, setAnswer] = useState(item.label ?? item.suggestion ?? item.output ?? "");
    const index = ids.indexOf(item.id);
    const previous = index > 0 ? ids[index - 1] : null;
    const next = index >= 0 && index + 1 < ids.length ? ids[index + 1] : null;
    const fixed = answer.trim();
    const busy = review.isPending;
    const choosing = item.labels.length > 0;
    useEffect(() => {
        if (index >= 0 && index + 2 >= ids.length && hasMore) {
            loadMore();
        }
    }, [index, ids.length, hasMore, loadMore]);
    useEffect(() => {
        if (next !== null) {
            prefetch(next);
        }
    }, [next, prefetch]);
    useEffect(() => {
        const box = field.current;
        if (!editing || !box) {
            return;
        }
        box.focus();
        if (choosing) {
            box.select();
        } else {
            box.setSelectionRange(box.value.length, box.value.length);
        }
    }, [editing, choosing]);
    const skip = () => onOpen(next);
    const decide = (decision: Decision, label?: string) => {
        review.mutate(
            { id: item.id, decision, label },
            {
                onSuccess: (done) => {
                    const accepted = done.status === "accepted";
                    toast({
                        title: accepted ? (label ? "Edited and accepted" : "Accepted") : "Rejected",
                        tone: accepted ? "success" : "neutral",
                    });
                    onOpen(next);
                },
            },
        );
    };
    const accept = () => (item.suggestion ? decide("accept") : setEditing(true));
    const saveEdit = () => {
        if (!fixed) {
            field.current?.focus();
            return;
        }
        decide("accept", fixed === item.suggestion ? undefined : fixed);
    };
    const cancelEdit = () => {
        setEditing(false);
        setAnswer(item.label ?? item.suggestion ?? item.output ?? "");
    };
    const keys = useRef({ accept, decide, skip, previous, onOpen, busy, editing, setEditing });
    keys.current = { accept, decide, skip, previous, onOpen, busy, editing, setEditing };
    useEffect(() => {
        const onKey = (event: KeyboardEvent) => {
            if (event.metaKey || event.ctrlKey || event.altKey || typing(event.target)) {
                return;
            }
            const current = keys.current;
            const actions: Record<string, () => void> = {
                a: current.accept,
                e: () => current.setEditing(true),
                r: () => current.decide("reject"),
                s: current.skip,
                j: current.skip,
                k: () => current.previous !== null && current.onOpen(current.previous),
                escape: () => current.onOpen(null),
            };
            const action = actions[event.key.toLowerCase()];
            if (action && !current.busy && !current.editing) {
                event.preventDefault();
                action();
            }
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, []);
    const signal = signalLabel(item.signal);
    const reviewed = reviewedText(item);
    const left = leftText(index, total);
    return (
        <Card>
            <CardContent className="flex flex-col gap-panel">
                <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex min-w-0 flex-col gap-1">
                        <div className="flex flex-wrap items-center gap-2">
                            <span className="text-base font-semibold">{item.model_name}</span>
                            <Badge variant={feedbackStatusVariant(item.status)}>
                                {feedbackStatusLabel(item.status)}
                            </Badge>
                            {reviewed && (
                                <span className="text-sm text-muted-foreground">{reviewed}</span>
                            )}
                            {signal && (
                                <StatusText tone={item.signal === "conflict" ? "warning" : "info"}>
                                    {signal}
                                </StatusText>
                            )}
                        </div>
                        <Sender item={item} />
                    </div>
                    <div className="flex items-center gap-2">
                        {left && (
                            <span className="text-sm text-muted-foreground tabular-nums">
                                {left}
                            </span>
                        )}
                        <Button
                            variant="ghost"
                            disabled={previous === null}
                            onClick={() => previous !== null && onOpen(previous)}
                        >
                            <IconArrowLeft aria-hidden="true" />
                            Previous <Kbd>K</Kbd>
                        </Button>
                    </div>
                </div>
                <div className="grid grid-cols-3 gap-4">
                    <Column label="Input">
                        <Pane>{item.input}</Pane>
                    </Column>
                    <ModelAnswer item={item} />
                    {editing ? (
                        <AnswerEditor
                            item={item}
                            value={answer}
                            onChange={setAnswer}
                            onSubmit={saveEdit}
                            onCancel={cancelEdit}
                            fieldRef={field}
                        />
                    ) : (
                        <Suggestion item={item} />
                    )}
                </div>
                {item.comment && (
                    <Column label="Comment">
                        <p className="whitespace-pre-wrap break-words">{item.comment}</p>
                    </Column>
                )}
                <Related items={item.related} onOpen={onOpen} />
                <div className="flex flex-col gap-3 border-t pt-4">
                    <div className="flex flex-wrap items-center gap-2">
                        {editing ? (
                            <>
                                <Button onClick={saveEdit} disabled={busy || !fixed}>
                                    <IconCheck aria-hidden="true" />
                                    Accept edited answer <Kbd>⌘↵</Kbd>
                                </Button>
                                <Button variant="outline" onClick={cancelEdit} disabled={busy}>
                                    Cancel <Kbd>Esc</Kbd>
                                </Button>
                            </>
                        ) : (
                            <>
                                <Button onClick={accept} disabled={busy || !item.suggestion}>
                                    <IconCheck aria-hidden="true" />
                                    Accept <Kbd>A</Kbd>
                                </Button>
                                <Button
                                    variant="outline"
                                    onClick={() => setEditing(true)}
                                    disabled={busy}
                                >
                                    <IconPencil aria-hidden="true" />
                                    Edit answer <Kbd>E</Kbd>
                                </Button>
                                <Button
                                    variant="outline"
                                    onClick={() => decide("reject")}
                                    disabled={busy}
                                >
                                    <IconX aria-hidden="true" />
                                    Reject <Kbd>R</Kbd>
                                </Button>
                                <Button variant="ghost" onClick={skip} disabled={busy}>
                                    <IconPlayerSkipForward aria-hidden="true" />
                                    Skip <Kbd>S</Kbd>
                                </Button>
                            </>
                        )}
                        <span className="flex-1" />
                        <span className="text-sm text-muted-foreground">
                            {item.assignee ? `Assigned to ${item.assignee}` : "Not assigned"}
                        </span>
                        <Button
                            variant="ghost"
                            disabled={assign.isPending}
                            onClick={() => assign.mutate({ id: item.id, mine: !item.assignee })}
                        >
                            {item.assignee ? "Unassign" : "Assign to me"}
                        </Button>
                    </div>
                    <KbdHint keys={["Esc"]}>Back to the list</KbdHint>
                    <ErrorLine error={review.error ?? assign.error} />
                </div>
            </CardContent>
        </Card>
    );
}

export function FeedbackReview(props: Props) {
    const item = useFeedbackItem(props.id);
    if (item.error) {
        return (
            <QueryError
                error={item.error}
                retry={item.refetch}
                notFound={
                    <NotFoundState
                        title="Feedback not found"
                        primary={{ label: "Go to Feedback", onClick: () => props.onOpen(null) }}
                    >
                        {`There is no feedback #${props.id}. It may have been deleted.`}
                    </NotFoundState>
                }
            />
        );
    }
    if (!item.data) {
        return <p className="text-muted-foreground">Loading…</p>;
    }
    return <Review {...props} item={item.data} />;
}
