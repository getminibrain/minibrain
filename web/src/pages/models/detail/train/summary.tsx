import {
    IconCpu,
    IconLayoutRows,
    IconListNumbers,
    IconMemory,
    IconPlayerPlay,
    IconSchool,
    IconScript,
    IconServer,
    IconStopwatch,
} from "@tabler/icons-react";
import { useFeedbackTrainingRows } from "~/api/feedbackQueries";
import {
    BlockedReasons,
    SummaryCard,
    SummaryFact,
    SummaryFacts,
    SummaryLine,
    SummarySection,
} from "~/components/CreateLayout";
import { PoolLink } from "~/components/PoolLink";
import { count } from "~/lib/format";
import { durationText } from "~/lib/jobs";
import { MemorySummary } from "./parts";
import type { PoolPlan } from "./pools";
import { duration, gigabytes, hoursText } from "./recipe";
import type { TrainRun } from "./useTrainRun";

function estimateOf(run: TrainRun, blocked: string | null): string {
    const info = run.info;
    if (blocked || !run.chosen) {
        return "–";
    }
    if (info?.chosen && info.minutes !== null && info.minutes !== undefined) {
        return `≈ ${duration(info.minutes)}`;
    }
    return run.planning ? "Planning…" : "–";
}

export function problemsOf(run: TrainRun, blocked: string | null): string[] {
    if (blocked) {
        return [blocked];
    }
    if (!run.training) {
        return run.failure ? [run.failure] : [];
    }
    if (!run.chosen) {
        return ["Add training data first: training needs examples."];
    }
    const own = run.issues.filter((issue) => issue.field !== "compute");
    const shown = own.length > 0 ? own : run.issues;
    return [...(run.failure ? [run.failure] : []), ...shown.map((issue) => issue.text)];
}

function MachineFits({ pool }: { pool: PoolPlan }) {
    return (
        <>
            <span className="text-muted-foreground">Training fit</span>
            <ul className="flex flex-col gap-1">
                {pool.machines.map((item) => (
                    <li key={item.name} className="flex items-baseline justify-between gap-3">
                        <span className="min-w-0 truncate">{item.name}</span>
                        <span
                            className={
                                item.chosen
                                    ? "shrink-0 text-muted-foreground tabular-nums"
                                    : "shrink-0 text-destructive"
                            }
                        >
                            {item.chosen
                                ? `${gigabytes(item.available_bytes)} · ≈ ${duration(item.minutes)}`
                                : (item.reason ?? "does not fit")}
                        </span>
                    </li>
                ))}
            </ul>
        </>
    );
}

function PoolFact({ run }: { run: TrainRun }) {
    const machine = run.pickedMachine;
    const chosen =
        run.pools.find((item) => item.name === run.compute) ??
        run.pools.find((item) => item.name === machine?.pool);
    const name = chosen?.name ?? machine?.pool;
    if (!name) {
        return "–";
    }
    const pinned = run.recipe.machine !== "auto";
    return (
        <PoolLink
            name={name}
            align="end"
            machine={machine && pinned ? machine.name : null}
            details={chosen ? <MachineFits pool={chosen} /> : undefined}
        />
    );
}

function scoreTime(run: TrainRun): string {
    return run.scoreSeconds === null ? "–" : `≈ ${durationText(run.scoreSeconds)}`;
}

function heldOutText(run: TrainRun): string {
    return run.chosen ? `scored on ${count(run.heldOut)} held-out rows` : "not scored: no data";
}

function ScoreSummary({
    run,
    blocked,
    changed,
}: {
    run: TrainRun;
    blocked: string | null;
    changed: boolean;
}) {
    return (
        <SummaryCard>
            <SummarySection title="Estimate">
                <SummaryFacts>
                    <SummaryFact icon={IconStopwatch} label="Scores in">
                        {blocked || !run.chosen ? "–" : scoreTime(run)}
                    </SummaryFact>
                    <SummaryFact icon={IconLayoutRows} label="Held out">
                        {count(run.heldOut)}
                    </SummaryFact>
                    <SummaryFact icon={IconScript} label="Instructions">
                        {changed ? "Changed" : "Unchanged"}
                    </SummaryFact>
                </SummaryFacts>
            </SummarySection>
            <SummarySection title="Result">
                <SummaryLine icon={IconPlayerPlay} className="tabular-nums">
                    {`v${run.number} · instructions only, ${heldOutText(run)}`}
                </SummaryLine>
            </SummarySection>
            <BlockedReasons reasons={problemsOf(run, blocked)} />
        </SummaryCard>
    );
}

function trainedOn(rows: number, feedback: number): string {
    const base = `trained on ${count(rows)} rows`;
    if (feedback === 0) {
        return base;
    }
    return `${base} plus ${count(feedback)} accepted feedback ${feedback === 1 ? "row" : "rows"}`;
}

function ResultLine({ slug, run }: { slug: string; run: TrainRun }) {
    const feedback = useFeedbackTrainingRows(slug, run.chosen?.id ?? null).data?.rows ?? 0;
    const rows = run.info?.rows ?? run.available;
    return (
        <SummaryLine icon={IconSchool} className="tabular-nums">
            {`v${run.number} · ${trainedOn(rows, feedback)}, ${heldOutText(run)}`}
        </SummaryLine>
    );
}

export function RunSummary({
    slug,
    run,
    blocked,
    changed,
}: {
    slug: string;
    run: TrainRun;
    blocked: string | null;
    changed: boolean;
}) {
    if (!run.training) {
        return <ScoreSummary run={run} blocked={blocked} changed={changed} />;
    }
    const info = run.info;
    const fits = Boolean(info?.chosen);
    const machine = fits ? run.pickedMachine : null;
    const minutes = fits ? (info?.minutes ?? null) : null;
    const unknown = info && !info.chosen && info.level === "unknown" ? info.basis : null;
    const memoryLabel = info?.memory_label ?? "memory";
    return (
        <SummaryCard>
            <SummarySection title="Estimate">
                <SummaryFacts>
                    <SummaryFact icon={IconStopwatch} label="Time">
                        {estimateOf(run, blocked)}
                    </SummaryFact>
                    <SummaryFact icon={IconServer} label="Pool">
                        <PoolFact run={run} />
                    </SummaryFact>
                    <SummaryFact
                        icon={IconCpu}
                        label={machine?.kind === "cpu" ? "CPU-hours" : "GPU-hours"}
                    >
                        {minutes === null ? "–" : hoursText(minutes)}
                    </SummaryFact>
                    <SummaryFact icon={IconListNumbers} label="Queue">
                        {info
                            ? info.queue.ahead > 0
                                ? `${info.queue.ahead} ahead`
                                : "Starts now"
                            : "–"}
                    </SummaryFact>
                </SummaryFacts>
            </SummarySection>
            <SummarySection title="Memory">
                {run.option && !blocked ? (
                    <MemorySummary
                        option={run.option}
                        memoryLabel={memoryLabel}
                        pool={run.pickedMachine?.pool ?? null}
                    />
                ) : (
                    <SummaryLine icon={IconMemory} className="text-muted-foreground">
                        {run.planning ? "Planning…" : "Not planned yet"}
                    </SummaryLine>
                )}
                {unknown && <p className="text-muted-foreground">{unknown}</p>}
            </SummarySection>
            <SummarySection title="Result">
                <ResultLine slug={slug} run={run} />
            </SummarySection>
            <BlockedReasons reasons={problemsOf(run, blocked)} />
        </SummaryCard>
    );
}

export function statusOf(run: TrainRun, blocked: string | null): string {
    const problem = problemsOf(run, blocked)[0];
    if (problem) {
        return problem;
    }
    if (!run.training || run.ready) {
        return "";
    }
    return run.planning ? "Planning…" : "Waiting for the planner.";
}
