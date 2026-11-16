import { ChartLine, Hourglass, Minus, TrendingDown, TriangleAlert } from "lucide-react";
import {
    SegmentedTabs,
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "obp-ui";
import { type ReactNode, useState } from "react";
import type { JobDetail, JobMetrics, TrainingMetrics } from "~/api/client";
import { useComparedRun } from "~/api/jobPageQueries";
import { ErrorLine, PanelSection } from "~/components/Section";
import { ChartLegend } from "~/components/charts/TimeChart";
import { count } from "~/lib/format";
import { durationText } from "~/lib/jobs";
import { bytes } from "~/lib/time";
import {
    type LaneSeries,
    LossFigure,
    type Readout,
    type ReadoutLine,
    WARMUP_FILL,
} from "./LossFigure";
import {
    type CurveRow,
    type Previous,
    type Training,
    type Verdict,
    bestHeld,
    curveRows,
    domainEnd,
    epochAt,
    epochBoundaries,
    lastStep,
    nearest,
    verdict,
    warmupEnd,
} from "./lossCurve";

const TRAIN = "var(--primary)";
const HELD_OUT = "var(--file-sql)";
const PREVIOUS = "color-mix(in srgb, var(--primary) 45%, var(--muted-foreground))";
const PREVIOUS_HELD_OUT = "color-mix(in srgb, var(--file-sql) 45%, var(--muted-foreground))";
const PREVIOUS_DASH = "5 4";
const LOSS = (value: number) => value.toFixed(3);
const RATE = (value: number) => (value === 0 ? "0" : value.toExponential(1));
const RATE_LINE = "var(--muted-foreground)";
const NONE = "none";
const SMOOTH_KEY = "minibrain.loss-smoothing";
const RAW = "raw";
const SMOOTH = "smooth";
const SMOOTHING_TABS = [
    { key: RAW, label: "Raw" },
    { key: SMOOTH, label: "Smoothed" },
];

type Comparable = NonNullable<JobMetrics["comparable"]>[number];
type Choice = number | typeof NONE | null;
type Fact = [string, ReactNode];
type Smoothing = typeof RAW | typeof SMOOTH;

const SHARE = new Intl.NumberFormat(undefined, { style: "percent", maximumFractionDigits: 1 });
const SCHEDULES: Record<string, string> = {
    cosine: "eases down to near 0 on a cosine schedule",
    linear: "falls in a straight line to 0 on a linear schedule",
    constant: "stays at its set value on a constant schedule",
};
const SCHEDULE_NAMES: Record<string, string> = {
    cosine: "Cosine schedule",
    linear: "Linear schedule",
    constant: "Constant schedule",
};

function storedSmoothing(): Smoothing {
    try {
        return window.localStorage.getItem(SMOOTH_KEY) === RAW ? RAW : SMOOTH;
    } catch {
        return SMOOTH;
    }
}

function useSmoothing() {
    const [value, setValue] = useState<Smoothing>(storedSmoothing);
    const choose = (next: Smoothing) => {
        setValue(next);
        try {
            window.localStorage.setItem(SMOOTH_KEY, next);
        } catch {}
    };
    return [value, choose] as const;
}

function lossSeries(
    training: TrainingMetrics,
    previous: Previous | null | undefined,
    smoothing: Smoothing,
): LaneSeries[] {
    const series: LaneSeries[] = [];
    if (previous && previous.points.length > 0) {
        series.push({
            key: "previous",
            label: `v${previous.version} training loss`,
            color: PREVIOUS,
            dash: PREVIOUS_DASH,
        });
    }
    if (previous && previous.evals.length > 0) {
        series.push({
            key: "previous_eval",
            label: `v${previous.version} held-out loss`,
            color: PREVIOUS_HELD_OUT,
            dash: PREVIOUS_DASH,
            dots: true,
        });
    }
    if (smoothing === SMOOTH) {
        series.push(
            { key: "loss", label: "Training loss (raw)", color: TRAIN, width: 1, opacity: 0.25 },
            { key: "smooth", label: "Training loss (smoothed)", color: TRAIN },
        );
    } else {
        series.push({ key: "loss", label: "Training loss", color: TRAIN });
    }
    if (training.evals.length > 0) {
        series.push({ key: "eval_loss", label: "Held-out loss", color: HELD_OUT, dots: true });
    }
    return series;
}

function legendSeries(series: LaneSeries[]): LaneSeries[] {
    const order: (keyof CurveRow)[] = ["smooth", "loss", "eval_loss", "previous", "previous_eval"];
    return series
        .filter((item) => item.opacity === undefined)
        .sort((left, right) => order.indexOf(left.key) - order.indexOf(right.key));
}

function latest(values: (number | null | undefined)[]): number | null {
    for (let index = values.length - 1; index >= 0; index -= 1) {
        const value = values[index];
        if (typeof value === "number") {
            return value;
        }
    }
    return null;
}

export function stepText(training: TrainingMetrics): string {
    if (training.step === null || training.step === undefined) {
        return "–";
    }
    return training.steps
        ? `${count(training.step)} of ${count(training.steps)}`
        : count(training.step);
}

function choiceLabel(item: Comparable): string {
    return item.live ? `v${item.version} (live)` : `v${item.version}`;
}

function CompareWith({
    value,
    comparable,
    onChange,
}: {
    value: number | typeof NONE;
    comparable: Comparable[];
    onChange: (next: number | typeof NONE) => void;
}) {
    return (
        <div className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">Compare with</span>
            <Select
                value={String(value)}
                onValueChange={(next) =>
                    next !== null && onChange(next === NONE ? NONE : Number(next))
                }
            >
                <SelectTrigger size="sm" aria-label="Compare with" className="w-32">
                    <SelectValue />
                </SelectTrigger>
                <SelectContent>
                    {[...comparable].reverse().map((item) => (
                        <SelectItem key={item.version} value={String(item.version)}>
                            {choiceLabel(item)}
                        </SelectItem>
                    ))}
                    <SelectItem value={NONE}>None</SelectItem>
                </SelectContent>
            </Select>
        </div>
    );
}

function lossText(value: number | null): string {
    return value === null ? "–" : LOSS(value);
}

function Figure({ children }: { children: ReactNode }) {
    return <span className="tabular-nums">{children}</span>;
}

export function trainingFacts(
    job: JobDetail,
    training: TrainingMetrics | null | undefined,
): Fact[] {
    if (!training || training.points.length === 0) {
        return [];
    }
    const running = job.status === "running";
    const facts: Fact[] = [["Step", <Figure key="step">{stepText(training)}</Figure>]];
    if (training.epoch !== null && training.epoch !== undefined) {
        facts.push(["Epoch", <Figure key="epoch">{training.epoch.toFixed(2)}</Figure>]);
    }
    if (running) {
        const eta = training.eta_seconds;
        facts.push([
            "Time left",
            <Figure key="eta">
                {eta === null || eta === undefined ? "–" : durationText(eta)}
            </Figure>,
        ]);
    }
    facts.push(
        [
            "Training loss",
            <Figure key="loss">
                {lossText(latest(training.points.map((point) => point.loss)))}
            </Figure>,
        ],
        [
            "Held-out loss",
            <Figure key="held">
                {lossText(latest(training.evals.map((point) => point.eval_loss)))}
            </Figure>,
        ],
        [
            running ? "Tokens per second" : "Mean tokens per second",
            <Figure key="speed">{count(training.tokens_per_second)}</Figure>,
        ],
        ["Peak memory", <Figure key="memory">{bytes(training.memory_bytes)}</Figure>],
    );
    return facts;
}

function waiting(job: JobDetail): string {
    return job.status === "queued" || job.status === "running"
        ? "Waiting for the first training step."
        : "This run recorded no training steps.";
}

export function LossBody({ job, metrics }: { job: JobDetail; metrics: JobMetrics | undefined }) {
    const training = metrics?.training;
    if (!training || training.points.length === 0) {
        return <p className="text-muted-foreground">{waiting(job)}</p>;
    }
    return (
        <LossChart
            job={job}
            training={training}
            fallback={metrics?.previous}
            comparable={metrics?.comparable ?? []}
        />
    );
}

function heldOutText(training: Training | null | undefined): string {
    const rows = training?.loss_rows;
    if (rows === null || rows === undefined) {
        return "";
    }
    return ` Held-out loss is measured on the first ${count(rows)} held-out ${rows === 1 ? "row" : "rows"}; the final score uses every held-out row.`;
}

function lossTip(job: JobDetail, metrics: JobMetrics | undefined): string {
    const curves = metrics?.comparable?.length
        ? "Training and held-out loss per step, with another trained version's run behind them in grey."
        : "Training loss per step, held-out loss at each evaluation.";
    return `${curves}${heldOutText(job.setup?.training)} ${rateTip(job.setup?.training)}`;
}

function rateTip(training: Training | null | undefined): string {
    const schedule = SCHEDULES[training?.scheduler ?? "cosine"] ?? SCHEDULES.cosine;
    const warmup = training?.warmup;
    const lead = "The learning rate below sets how far each step moves the weights:";
    if (warmup === null || warmup === undefined) {
        return `${lead} it warms up, then ${schedule}.`;
    }
    if (warmup === 0) {
        return `${lead} no warmup, it starts at its set value and ${schedule}.`;
    }
    return `${lead} it ramps up from 0 over the first ${SHARE.format(warmup)} of steps (shaded), then ${schedule}.`;
}

export function LossSection({ job, metrics }: { job: JobDetail; metrics: JobMetrics | undefined }) {
    return (
        <PanelSection icon={ChartLine} title="Loss" tip={lossTip(job, metrics)}>
            <LossBody job={job} metrics={metrics} />
        </PanelSection>
    );
}

function useComparison(job: JobDetail, fallback: Previous | null | undefined) {
    const [choice, setChoice] = useState<Choice>(null);
    const compared = useComparedRun(job.id, typeof choice === "number" ? choice : null);
    if (choice === NONE) {
        return { previous: null, value: NONE, setChoice, compared } as const;
    }
    if (choice === null) {
        return {
            previous: fallback,
            value: fallback?.version ?? NONE,
            setChoice,
            compared,
        } as const;
    }
    return { previous: compared.data, value: choice, setChoice, compared } as const;
}

const VERDICT_ICONS = {
    overfit: TriangleAlert,
    waiting: Hourglass,
    single: Hourglass,
    flat: Minus,
    falling: TrendingDown,
} as const;

function VerdictLine({ verdict }: { verdict: Verdict }) {
    const Icon = VERDICT_ICONS[verdict.kind];
    const warning = verdict.kind === "overfit";
    return (
        <p
            className={
                warning
                    ? "flex items-center gap-2 font-medium text-warning"
                    : "flex items-center gap-2 font-medium"
            }
        >
            <Icon
                aria-hidden="true"
                className={warning ? "size-4 shrink-0" : "size-4 shrink-0 text-muted-foreground"}
            />
            {verdict.text}
        </p>
    );
}

type Valued = { step: number; value: number };

function withValue<T extends { step: number }>(
    items: readonly T[],
    value: (item: T) => number | null | undefined,
): Valued[] {
    return items.flatMap((item) => {
        const found = value(item);
        return typeof found === "number" ? [{ step: item.step, value: found }] : [];
    });
}

type LineSpec = {
    key: string;
    items: Valued[];
    label: string;
    color: string;
    until: number;
    dot?: boolean;
    format?: (value: number) => string;
};

function readoutLine(spec: LineSpec, step: number): ReadoutLine[] {
    const found = step <= spec.until ? nearest(spec.items, step) : null;
    if (!found) {
        return [];
    }
    const note = found.step === step ? "" : ` at step ${count(found.step)}`;
    return [
        {
            key: spec.key,
            value: (spec.format ?? LOSS)(found.value),
            label: `${spec.label}${note}`,
            color: spec.color,
            dot: spec.dot,
        },
    ];
}

function readoutSpecs(
    training: TrainingMetrics,
    previous: Previous | null | undefined,
    rows: CurveRow[],
    smoothing: Smoothing,
): LineSpec[] {
    const version = previous ? `v${previous.version}` : "";
    const own = Math.max(lastStep(training.points), lastStep(training.evals));
    const theirs = Math.max(lastStep(previous?.points ?? []), lastStep(previous?.evals ?? []));
    const specs: LineSpec[] = [
        {
            key: "loss",
            items: withValue(training.points, (point) => point.loss),
            label: "Training loss",
            until: own,
            color: TRAIN,
        },
    ];
    if (smoothing === SMOOTH) {
        specs.push({
            key: "smooth",
            items: withValue(rows, (row) => row.smooth),
            label: "Smoothed",
            until: own,
            color: TRAIN,
        });
    }
    specs.push(
        {
            key: "held",
            items: withValue(training.evals, (point) => point.eval_loss),
            label: "Held-out loss",
            until: own,
            color: HELD_OUT,
            dot: true,
        },
        {
            key: "previous",
            items: withValue(rows, (row) => row.previous),
            label: `${version} training loss${smoothing === SMOOTH ? ", smoothed" : ""}`,
            until: theirs,
            color: PREVIOUS,
        },
        {
            key: "previous_held",
            items: withValue(previous?.evals ?? [], (point) => point.eval_loss),
            label: `${version} held-out loss`,
            until: theirs,
            color: PREVIOUS_HELD_OUT,
            dot: true,
        },
        {
            key: "rate",
            items: withValue(training.points, (point) => point.learning_rate),
            label: "Learning rate",
            until: own,
            color: RATE_LINE,
            format: RATE,
        },
    );
    return specs;
}

function readoutOf(
    training: TrainingMetrics,
    previous: Previous | null | undefined,
    setup: Training | null | undefined,
    rows: CurveRow[],
    smoothing: Smoothing,
): (step: number) => Readout {
    const specs = readoutSpecs(training, previous, rows, smoothing);
    const elapsed = withValue(training.points, (point) => point.elapsed_seconds);
    return (step) => {
        const epoch = epochAt(training, setup, step);
        const time = nearest(elapsed, step);
        const title = [
            `Step ${count(step)}`,
            epoch === null ? null : `epoch ${epoch.toFixed(2)}`,
            time && time.step === step ? `${durationText(time.value)} in` : null,
        ]
            .filter(Boolean)
            .join(" · ");
        return { title, lines: specs.flatMap((spec) => readoutLine(spec, step)) };
    };
}

function nowMarker(job: JobDetail, training: TrainingMetrics) {
    const eta = training.eta_seconds;
    if (job.status !== "running" || training.step === null || !eta || eta <= 0) {
        return null;
    }
    return { step: training.step, label: `Now · ${durationText(eta)} left` };
}

function Schedule({
    setup,
    warmup,
    epochs,
}: {
    setup: Training | null | undefined;
    warmup: number;
    epochs: number[];
}) {
    const scheduler = setup?.scheduler ?? "cosine";
    return (
        <>
            <span className="text-foreground">Learning rate</span>
            <span>{SCHEDULE_NAMES[scheduler] ?? scheduler}</span>
            {warmup > 0 && (
                <span className="flex items-center gap-1.5">
                    <span
                        aria-hidden="true"
                        className="size-2.5 shrink-0 rounded-sm border"
                        style={{ background: WARMUP_FILL }}
                    />
                    <span className="tabular-nums">
                        {`Warmup, ${count(warmup)} ${warmup === 1 ? "step" : "steps"}`}
                    </span>
                </span>
            )}
            {epochs.length > 0 && (
                <span className="flex items-center gap-1.5">
                    <span aria-hidden="true" className="h-3 border-l border-dashed border-faint" />
                    Epoch boundary
                </span>
            )}
        </>
    );
}

function summary(job: JobDetail, training: TrainingMetrics, verdictText: string): string {
    const loss = latest(training.points.map((point) => point.loss));
    const held = training.evals.at(-1);
    const parts = [
        `Loss by step for job ${job.id}: ${verdictText}.`,
        `Training loss ${lossText(loss)} at step ${count(training.step ?? lastStep(training.points))}.`,
    ];
    if (held) {
        parts.push(`Held-out loss ${LOSS(held.eval_loss)} at step ${count(held.step)}.`);
    }
    return parts.join(" ");
}

function LossChart({
    job,
    training,
    fallback,
    comparable,
}: {
    job: JobDetail;
    training: TrainingMetrics;
    fallback: Previous | null | undefined;
    comparable: Comparable[];
}) {
    const { previous, value, setChoice, compared } = useComparison(job, fallback);
    const [smoothing, setSmoothing] = useSmoothing();
    const setup = job.setup?.training;
    const series = lossSeries(training, previous, smoothing);
    const end = domainEnd(training, previous);
    const rows = curveRows(training, previous, end, smoothing === SMOOTH);
    const active = job.status === "queued" || job.status === "running";
    const result = verdict(training, active);
    const warmup = warmupEnd(training, setup);
    const epochs = epochBoundaries(training, setup).filter((step) => step > 0 && step < end);
    return (
        <div className="flex flex-col gap-3">
            <div className="flex min-h-7 flex-wrap items-center justify-between gap-x-5 gap-y-2">
                <VerdictLine verdict={result} />
                <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
                    <fieldset
                        aria-label="Training loss smoothing"
                        className="m-0 min-w-0 border-0 p-0"
                    >
                        <SegmentedTabs
                            size="sm"
                            tabs={SMOOTHING_TABS}
                            active={smoothing}
                            onSelect={(next) => setSmoothing(next === RAW ? RAW : SMOOTH)}
                        />
                    </fieldset>
                    {comparable.length > 0 && (
                        <CompareWith value={value} comparable={comparable} onChange={setChoice} />
                    )}
                </div>
            </div>
            <div className="flex flex-col gap-1.5">
                <ChartLegend series={legendSeries(series)} />
                {previous && !previous.same_data && (
                    <p className="text-sm text-muted-foreground">
                        {`v${previous.version} trained on different data, so losses aren't directly comparable.`}
                    </p>
                )}
            </div>
            <ErrorLine error={compared.error} onRetry={compared.refetch} />
            <LossFigure
                sync={`loss-${job.id}`}
                rows={rows}
                series={series}
                domain={[0, end]}
                warmup={warmup}
                epochs={epochs}
                best={training.evals.length > 1 ? bestHeld(training.evals) : null}
                overfit={training.rising_from ?? null}
                now={nowMarker(job, training)}
                readout={readoutOf(training, previous, setup, rows, smoothing)}
                schedule={<Schedule setup={setup} warmup={warmup} epochs={epochs} />}
                rateFormat={RATE}
                rateColor={RATE_LINE}
                label={summary(job, training, result.text)}
            />
        </div>
    );
}

export function RateSection(_props: { job: JobDetail; metrics: JobMetrics | undefined }) {
    return null;
}
