import { IconGitCompare } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { Button, Link, cn } from "obp-ui";
import type { ReactNode } from "react";
import { type ExampleAnswer, type VersionInfo, api, unwrap } from "~/api/client";
import { keys } from "~/api/queries";
import { ErrorLine, PanelSection } from "~/components/Section";
import { useCan } from "~/lib/access";
import { count, percent } from "~/lib/format";
import { metricName } from "~/lib/metrics";
import { modelCompareHref } from "~/lib/modelLinks";
import { type Peers, type Phase, UNSCORED, pts, referenceOf } from "./versionState";

const SHOWN_LABELS = 6;
const SHOWN_EXAMPLES = 5;
const LIST_HEIGHT = "min-h-[18.75rem]";
const PLACEHOLDER_HEIGHT = "min-h-[18.875rem]";
const LABELS_HEIGHT = "min-h-[4.75rem]";

export function useAnswers(slug: string, number: number, against: number | null, enabled: boolean) {
    return useQuery({
        queryKey: [...keys.answers(slug, number), against],
        queryFn: () =>
            unwrap(
                api.GET("/api/models/{name}/versions/{number}/answers", {
                    params: {
                        path: { name: slug, number },
                        query: against === null ? {} : { against },
                    },
                }),
            ),
        enabled,
        retry: false,
    });
}

export type Verdict = "better" | "worse" | "same";

export function verdictOf(answer: ExampleAnswer, metric: string | null | undefined): Verdict {
    if (!answer.live || !metric) {
        return "same";
    }
    const mine = answer.version.scores[metric] ?? 0;
    const theirs = answer.live.scores[metric] ?? 0;
    if (mine > theirs + 1e-9) {
        return "better";
    }
    return mine < theirs - 1e-9 ? "worse" : "same";
}

function Answered({
    label,
    value,
    right,
}: { label: string; value: string; right: boolean | null }) {
    return (
        <div className="flex min-w-0 flex-col">
            <span className="text-sm text-muted-foreground">{label}</span>
            <span
                className={cn(
                    "line-clamp-3 font-mono text-sm break-words",
                    right === false ? "text-destructive" : "text-foreground",
                )}
            >
                {value || "–"}
                {right !== null && (
                    <span className="sr-only">{right ? " (right)" : " (wrong)"}</span>
                )}
            </span>
        </div>
    );
}

export function inputOf(answer: ExampleAnswer): string {
    return answer.messages.filter((turn) => turn.role === "user").at(-1)?.content ?? "";
}

function rightOf(metric: string | null | undefined) {
    return (scores: Record<string, number>) =>
        metric && metric in scores ? scores[metric] >= 0.999 : null;
}

export function ExampleList({
    rows,
    mine,
    theirs,
    metric,
}: {
    rows: ExampleAnswer[];
    mine: string;
    theirs: string;
    metric: string | null | undefined;
}) {
    const right = rightOf(metric);
    return (
        <ul className="flex flex-col divide-y rounded-md border">
            {rows.map((answer, index) => (
                <li key={`${index}-${answer.expected}`} className="flex flex-col gap-2 px-3 py-2.5">
                    <span className="line-clamp-2 min-w-0 break-words">{inputOf(answer)}</span>
                    <div className="grid gap-3 sm:grid-cols-3">
                        <Answered label="Expected" value={answer.expected} right={null} />
                        <Answered
                            label={mine}
                            value={answer.version.answer}
                            right={right(answer.version.scores)}
                        />
                        <Answered
                            label={theirs}
                            value={answer.live?.answer ?? ""}
                            right={answer.live ? right(answer.live.scores) : null}
                        />
                    </div>
                </li>
            ))}
        </ul>
    );
}

type LabelChange = { label: string; mine: number; theirs: number; moved: number };

function recall(item: { support: number; correct: number }): number {
    return item.support > 0 ? item.correct / item.support : 0;
}

export function labelChanges(version: VersionInfo, reference: VersionInfo): LabelChange[] {
    const theirs = new Map((reference.held_out?.labels ?? []).map((item) => [item.label, item]));
    return (version.held_out?.labels ?? [])
        .filter((item) => item.support > 0)
        .map((item) => {
            const other = theirs.get(item.label);
            return {
                label: item.label,
                mine: recall(item),
                theirs: other ? recall(other) : 0,
                moved: item.correct - (other?.correct ?? 0),
            };
        })
        .sort(
            (left, right) =>
                Math.abs(right.moved) - Math.abs(left.moved) ||
                Math.abs(right.mine - right.theirs) - Math.abs(left.mine - left.theirs) ||
                left.label.localeCompare(right.label),
        );
}

function Placeholder({ children, className }: { children: ReactNode; className?: string }) {
    return (
        <div
            className={cn(
                "flex items-center justify-center rounded-md border border-dashed px-3 text-center text-muted-foreground",
                className,
            )}
        >
            {children}
        </div>
    );
}

function LabelBar({ change, mine, theirs }: { change: LabelChange; mine: string; theirs: string }) {
    const delta = change.mine - change.theirs;
    const text = pts(delta);
    return (
        <li
            className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)_5.5rem] items-center gap-3"
            title={`${change.label}: ${mine} ${percent(change.mine)}, ${theirs} ${percent(change.theirs)}`}
        >
            <span className="truncate font-mono text-sm">{change.label}</span>
            <span className="relative h-2 rounded-sm bg-secondary" aria-hidden="true">
                <span
                    className="absolute inset-y-0 left-0 rounded-sm bg-primary"
                    style={{ width: `${change.mine * 100}%` }}
                />
                <span
                    className="absolute -inset-y-1 w-0.5 -translate-x-1/2 bg-foreground"
                    style={{ left: `${change.theirs * 100}%` }}
                />
            </span>
            <span className="text-right text-sm whitespace-nowrap tabular-nums">
                {percent(change.mine)}{" "}
                <span
                    className={
                        text.startsWith("±")
                            ? "text-muted-foreground"
                            : delta > 0
                              ? "text-success"
                              : "text-destructive"
                    }
                >
                    {text.replace(" pts", "")}
                </span>
                <span className="sr-only">{` points vs ${theirs}`}</span>
            </span>
        </li>
    );
}

function LabelBars({
    version,
    reference,
    label,
}: {
    version: VersionInfo;
    reference: VersionInfo;
    label: string;
}) {
    const changes = labelChanges(version, reference);
    const shown = changes.slice(0, SHOWN_LABELS);
    if (shown.length === 0) {
        return (
            <Placeholder className={LABELS_HEIGHT}>
                {`${metricName(version.main_metric)} has no per-label results`}
            </Placeholder>
        );
    }
    return (
        <ul
            className={cn("grid content-start gap-x-8 gap-y-2 md:grid-cols-2", LABELS_HEIGHT)}
            aria-label={`Recall by label, v${version.number} vs ${label}`}
        >
            {shown.map((change) => (
                <LabelBar
                    key={change.label}
                    change={change}
                    mine={`v${version.number}`}
                    theirs={label}
                />
            ))}
        </ul>
    );
}

function Answer({ label, value, right }: { label: string; value: string; right: boolean | null }) {
    return (
        <span className="flex min-w-0 items-baseline gap-1.5">
            <span className="shrink-0 text-muted-foreground">{label}</span>
            <span
                className={cn(
                    "truncate font-mono",
                    right === true && "text-success",
                    right === false && "text-destructive",
                )}
                title={value}
            >
                {value || "–"}
            </span>
            {right !== null && <span className="sr-only">{right ? "(right)" : "(wrong)"}</span>}
        </span>
    );
}

function Moved({
    title,
    tip,
    rows,
    mine,
    theirs,
    metric,
    empty,
}: {
    title: string;
    tip: string;
    rows: ExampleAnswer[] | null;
    mine: string;
    theirs: string;
    metric: string | null | undefined;
    empty: ReactNode;
}) {
    const right = rightOf(metric);
    return (
        <div className="flex min-w-0 flex-col gap-2">
            <h3 className="flex items-baseline gap-2 font-medium">
                {title}
                {rows && (
                    <span className="text-sm font-normal text-muted-foreground tabular-nums">
                        {count(rows.length)}
                    </span>
                )}
                <span className="text-sm font-normal text-muted-foreground">{tip}</span>
            </h3>
            {rows && rows.length > 0 ? (
                <ul className={cn("flex flex-col divide-y rounded-md border", LIST_HEIGHT)}>
                    {rows.slice(0, SHOWN_EXAMPLES).map((answer, index) => (
                        <li
                            key={`${index}-${answer.expected}`}
                            className="flex h-15 flex-col justify-center gap-0.5 px-3"
                        >
                            <span className="truncate" title={inputOf(answer)}>
                                {inputOf(answer)}
                            </span>
                            <span className="grid grid-cols-2 gap-3 text-sm">
                                <Answer
                                    label={mine}
                                    value={answer.version.answer}
                                    right={right(answer.version.scores)}
                                />
                                <Answer
                                    label={theirs}
                                    value={answer.live?.answer ?? ""}
                                    right={answer.live ? right(answer.live.scores) : null}
                                />
                            </span>
                        </li>
                    ))}
                </ul>
            ) : (
                <Placeholder className={PLACEHOLDER_HEIGHT}>{empty}</Placeholder>
            )}
        </div>
    );
}

function unavailable(
    version: VersionInfo,
    phase: Phase,
    peers: Peers,
    builder: boolean,
): string | null {
    if (UNSCORED.includes(phase)) {
        return `Shown once v${version.number} is scored`;
    }
    if (phase !== "ready" || version.score === null) {
        return `v${version.number} has no scores to compare`;
    }
    if (!referenceOf(peers)) {
        return version.number === 0
            ? "v0 is the baseline; there is nothing older to compare it with"
            : "No other scored version to compare with";
    }
    return builder ? null : "Answer-level changes are shown to builders";
}

export function ChangesSection({
    slug,
    version,
    phase,
    peers,
}: {
    slug: string;
    version: VersionInfo;
    phase: Phase;
    peers: Peers;
}) {
    const can = useCan();
    const reference = referenceOf(peers);
    const blocked = unavailable(version, phase, peers, can.build);
    const answers = useAnswers(slug, version.number, reference?.version.number ?? null, !blocked);
    const mine = `v${version.number}`;
    const theirs = reference?.label ?? "";
    const examples = answers.data?.examples ?? [];
    const metric = answers.data?.metric;
    const missing =
        answers.isSuccess && examples.length === 0
            ? "Answer-level changes need per-row results; not available for this version yet"
            : null;
    const loading = answers.isLoading ? "Comparing answers…" : null;
    const listEmpty = blocked ?? missing ?? loading;
    const groups =
        listEmpty || answers.error
            ? null
            : {
                  better: examples.filter((answer) => verdictOf(answer, metric) === "better"),
                  worse: examples.filter((answer) => verdictOf(answer, metric) === "worse"),
              };
    const scoredWith = phase === "ready" && version.score !== null;
    return (
        <PanelSection
            icon={IconGitCompare}
            title="Changes"
            tip={
                reference
                    ? `Against ${reference.label}, on the same held-out rows. Bars are recall by label: the share of each label's rows answered right; the line marks ${reference.label}.`
                    : "Where this version answers differently from the live version, or from v0 when nothing is live."
            }
            actions={
                reference && !blocked ? (
                    <Button variant="outline" asChild>
                        <Link
                            href={modelCompareHref(
                                slug,
                                Math.min(reference.version.number, version.number),
                                Math.max(reference.version.number, version.number),
                            )}
                        >
                            All in Compare →
                        </Link>
                    </Button>
                ) : (
                    <Button variant="outline" disabled>
                        All in Compare →
                    </Button>
                )
            }
        >
            <div className="flex flex-col gap-6">
                <div className="flex flex-col gap-2">
                    <h3 className="flex items-baseline gap-2 font-medium">
                        By label
                        <span className="text-sm font-normal text-muted-foreground">
                            {reference ? `recall, ${mine} vs ${theirs}` : "recall"}
                        </span>
                    </h3>
                    {scoredWith && reference ? (
                        <LabelBars version={version} reference={reference.version} label={theirs} />
                    ) : (
                        <Placeholder className={LABELS_HEIGHT}>{blocked ?? "–"}</Placeholder>
                    )}
                </div>
                <ErrorLine error={answers.error} onRetry={answers.refetch} />
                <div className="grid gap-6 lg:grid-cols-2">
                    <Moved
                        title="Fixed"
                        tip={
                            reference
                                ? `${mine} right, ${theirs} wrong`
                                : `${mine} right where the reference was wrong`
                        }
                        rows={groups?.better ?? null}
                        mine={mine}
                        theirs={theirs}
                        metric={metric}
                        empty={listEmpty ?? `${mine} fixed nothing ${theirs} got wrong`}
                    />
                    <Moved
                        title="Broke"
                        tip={
                            reference
                                ? `${mine} wrong, ${theirs} right`
                                : `${mine} wrong where the reference was right`
                        }
                        rows={groups?.worse ?? null}
                        mine={mine}
                        theirs={theirs}
                        metric={metric}
                        empty={listEmpty ?? `${mine} broke nothing ${theirs} got right`}
                    />
                </div>
            </div>
        </PanelSection>
    );
}
