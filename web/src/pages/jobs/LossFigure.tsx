import type { ReactNode } from "react";
import {
    CartesianGrid,
    Line,
    LineChart,
    ReferenceArea,
    ReferenceDot,
    ReferenceLine,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
} from "recharts";
import type { CurveRow, Held } from "./lossCurve";

export type LaneSeries = {
    key: keyof CurveRow;
    label: string;
    color: string;
    dots?: boolean;
    width?: number;
    opacity?: number;
};

export type ReadoutLine = {
    key: string;
    value: string;
    label: string;
    color?: string;
    dot?: boolean;
};

export type Readout = { title: string; lines: ReadoutLine[] };

export type Marker = { step: number; label: string };

const AXIS_WIDTH = 56;
const MARGIN_RIGHT = 16;
const LOSS_HEIGHT = 240;
const RATE_HEIGHT = 96;
const MAX_EPOCH_LABELS = 10;
const TICK = { fill: "var(--muted-foreground)", fontSize: "var(--type-sm)" };
const GRID = "var(--border)";
const SURFACE = "var(--card)";
const BAND = "var(--muted)";
const EPOCH = "var(--faint)";
const STEPS = new Intl.NumberFormat();
const SMALL = { fill: "var(--muted-foreground)", fontSize: "var(--type-sm)" };

function ReadoutCard({ readout }: { readout: Readout }) {
    return (
        <div className="min-w-48 rounded-md border bg-popover px-3 py-2 text-sm text-popover-foreground shadow-e2">
            <div className="pb-1.5 text-muted-foreground tabular-nums">{readout.title}</div>
            <ul className="flex flex-col gap-1">
                {readout.lines.map((line) => (
                    <li key={line.key} className="flex items-center gap-2">
                        <span
                            aria-hidden="true"
                            className={
                                line.dot
                                    ? "size-1.5 shrink-0 rounded-full"
                                    : "h-0.5 w-3 shrink-0 rounded-full"
                            }
                            style={{ background: line.color ?? "transparent" }}
                        />
                        <span className="font-semibold tabular-nums">{line.value}</span>
                        <span className="min-w-0 truncate text-muted-foreground">{line.label}</span>
                    </li>
                ))}
            </ul>
        </div>
    );
}

function Flag({ cx, cy, color }: { cx?: number; cy?: number; color: string }) {
    if (cx === undefined || cy === undefined) {
        return null;
    }
    return (
        <g>
            <circle cx={cx} cy={cy} r={4} fill={color} stroke={SURFACE} strokeWidth={2} />
            <line x1={cx} y1={cy - 4} x2={cx} y2={cy - 22} stroke={color} strokeWidth={1.5} />
            <path d={`M${cx} ${cy - 22} L${cx + 10} ${cy - 18} L${cx} ${cy - 14} Z`} fill={color} />
            <text x={cx + 13} y={cy - 14} fill="var(--muted-foreground)" fontSize="var(--type-sm)">
                Best
            </text>
        </g>
    );
}

function StepAxis({ domain, hide }: { domain: [number, number]; hide: boolean }) {
    return (
        <XAxis
            dataKey="step"
            type="number"
            domain={domain}
            hide={hide}
            tickFormatter={(value: number) => STEPS.format(value)}
            tick={TICK}
            tickLine={false}
            axisLine={{ stroke: GRID }}
            minTickGap={40}
            allowDecimals={false}
        />
    );
}

function Lines({ series }: { series: LaneSeries[] }) {
    return series.map((item) => (
        <Line
            key={item.key}
            dataKey={item.key}
            name={item.label}
            type="linear"
            stroke={item.color}
            strokeOpacity={item.opacity ?? 1}
            strokeWidth={item.width ?? 2}
            strokeLinecap="round"
            strokeLinejoin="round"
            dot={item.dots ? { r: 3, strokeWidth: 2, stroke: SURFACE, fill: item.color } : false}
            activeDot={
                item.opacity !== undefined ? false : { r: 4, stroke: SURFACE, strokeWidth: 2 }
            }
            connectNulls
            isAnimationActive={false}
        />
    ));
}

function phases(warmup: number, epochs: number[], labelled: boolean) {
    const nodes: ReactNode[] = [];
    if (warmup > 0) {
        nodes.push(
            <ReferenceArea
                key="warmup"
                x1={0}
                x2={warmup}
                fill={BAND}
                fillOpacity={1}
                stroke="none"
                zIndex={-150}
                ifOverflow="hidden"
            />,
        );
    }
    const label = labelled && epochs.length <= MAX_EPOCH_LABELS;
    epochs.forEach((step, index) => {
        nodes.push(
            <ReferenceLine
                key={`epoch-${step}`}
                x={step}
                stroke={EPOCH}
                strokeDasharray="2 3"
                strokeWidth={1}
                zIndex={-50}
                label={
                    label ? { value: `Epoch ${index + 2}`, position: "top", ...SMALL } : undefined
                }
            />,
        );
    });
    return nodes;
}

export function LossFigure({
    sync,
    rows,
    series,
    domain,
    warmup,
    epochs,
    best,
    overfit,
    now,
    readout,
    schedule,
    rateFormat,
    rateColor,
    label,
}: {
    sync: string;
    rows: CurveRow[];
    series: LaneSeries[];
    domain: [number, number];
    warmup: number;
    epochs: number[];
    best: Held | null;
    overfit: number | null;
    now: Marker | null;
    readout: (step: number) => Readout;
    schedule: ReactNode;
    rateFormat: (value: number) => string;
    rateColor: string;
    label: string;
}) {
    const rates = rows.map((row) => row.rate).filter((value) => typeof value === "number");
    const peak = rates.length > 0 ? Math.max(...rates) : 0;
    const top = epochs.length > 0 && epochs.length <= MAX_EPOCH_LABELS ? 24 : 12;
    return (
        <figure aria-label={label} className="m-0 flex w-full flex-col text-sm tabular-nums">
            <div style={{ height: LOSS_HEIGHT }}>
                <ResponsiveContainer width="100%" height="100%">
                    <LineChart
                        data={rows}
                        syncId={sync}
                        margin={{ top, right: MARGIN_RIGHT, bottom: 4, left: 0 }}
                    >
                        <CartesianGrid vertical={false} stroke={GRID} strokeWidth={1} />
                        {StepAxis({ domain, hide: peak > 0 })}
                        <YAxis
                            width={AXIS_WIDTH}
                            tick={TICK}
                            tickLine={false}
                            axisLine={false}
                            tickFormatter={(value: number) => value.toFixed(2)}
                            domain={["auto", "auto"]}
                            tickCount={5}
                        />
                        {phases(warmup, epochs, true)}
                        <Tooltip
                            cursor={{ stroke: "var(--input)", strokeWidth: 1 }}
                            isAnimationActive={false}
                            content={(props) =>
                                props.active && typeof props.label === "number" ? (
                                    <ReadoutCard readout={readout(props.label)} />
                                ) : null
                            }
                        />
                        {overfit !== null && (
                            <ReferenceLine
                                x={overfit}
                                stroke="var(--warning)"
                                strokeWidth={1.5}
                                label={{
                                    value: "Overfitting from here",
                                    position: "insideTopLeft",
                                    fill: "var(--warning)",
                                    fontSize: "var(--type-sm)",
                                }}
                            />
                        )}
                        {now !== null && (
                            <ReferenceLine
                                x={now.step}
                                stroke="var(--muted-foreground)"
                                strokeDasharray="4 3"
                                strokeWidth={1}
                                label={{ value: now.label, position: "insideTopRight", ...SMALL }}
                            />
                        )}
                        {Lines({ series })}
                        {best !== null && (
                            <ReferenceDot
                                x={best.step}
                                y={best.eval_loss}
                                r={4}
                                zIndex={1300}
                                shape={(props: { cx?: number; cy?: number }) => (
                                    <Flag cx={props.cx} cy={props.cy} color="var(--file-sql)" />
                                )}
                            />
                        )}
                    </LineChart>
                </ResponsiveContainer>
            </div>
            {peak > 0 && (
                <>
                    <div
                        className="flex items-center gap-x-4 border-t pt-2 text-muted-foreground"
                        style={{ paddingLeft: AXIS_WIDTH }}
                    >
                        {schedule}
                    </div>
                    <div style={{ height: RATE_HEIGHT }}>
                        <ResponsiveContainer width="100%" height="100%">
                            <LineChart
                                data={rows}
                                syncId={sync}
                                accessibilityLayer={false}
                                margin={{ top: 8, right: MARGIN_RIGHT, bottom: 0, left: 0 }}
                            >
                                <CartesianGrid vertical={false} stroke={GRID} strokeWidth={1} />
                                {StepAxis({ domain, hide: false })}
                                <YAxis
                                    width={AXIS_WIDTH}
                                    tick={TICK}
                                    tickLine={false}
                                    axisLine={false}
                                    tickFormatter={rateFormat}
                                    domain={[0, peak]}
                                    ticks={[0, peak]}
                                />
                                {phases(warmup, epochs, false)}
                                <Tooltip
                                    cursor={{ stroke: "var(--input)", strokeWidth: 1 }}
                                    isAnimationActive={false}
                                    content={() => null}
                                />
                                {Lines({
                                    series: [
                                        { key: "rate", label: "Learning rate", color: rateColor },
                                    ],
                                })}
                            </LineChart>
                        </ResponsiveContainer>
                    </div>
                </>
            )}
        </figure>
    );
}

export const WARMUP_FILL = BAND;
