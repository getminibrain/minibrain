import { IconEye, IconX } from "@tabler/icons-react";
import {
    Button,
    Collapsible,
    CollapsibleContent,
    CollapsibleTrigger,
    Link,
    NumberField,
    StatusDot,
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
    Tooltip,
    TooltipContent,
    TooltipTrigger,
} from "obp-ui";
import { useState } from "react";
import { usePerson } from "~/api/authQueries";
import type { components } from "~/api/schema";
import { ErrorLine } from "~/components/Section";
import { StatusText, type Tone } from "~/components/models/StatusText";
import { allows } from "~/lib/access";
import { count } from "~/lib/format";
import { useDismiss } from "./Checks";
import {
    type Cleanup,
    type Step,
    conflictsStep,
    longStep,
    perLabelStep,
    personalStep,
    rareStep,
} from "./cleanup";

type CheckInfo = components["schemas"]["CheckInfo"];
type QueryShape = components["schemas"]["QueryShapeInfo"];
type DataSettings = components["schemas"]["DataSettings"];

export type Finding = CheckInfo & {
    rows: number;
    handled: boolean;
    columns: string[];
    table: string[][];
};

export type Limits = {
    minLabelRows: number;
    majorityShare: number;
    longTokens: number;
    charsPerToken: number;
};

export function limitsOf(settings: DataSettings | undefined): Limits | null {
    if (!settings) {
        return null;
    }
    const { min_label_rows, majority_share, long_tokens, chars_per_token } = settings;
    if (
        min_label_rows === undefined ||
        majority_share === undefined ||
        long_tokens === undefined ||
        chars_per_token === undefined
    ) {
        return null;
    }
    return {
        minLabelRows: min_label_rows,
        majorityShare: majority_share,
        longTokens: long_tokens,
        charsPerToken: chars_per_token,
    };
}

function findingOf(check: CheckInfo): Finding {
    return {
        ...check,
        rows: check.rows ?? 0,
        handled: check.handled ?? false,
        columns: check.columns ?? [],
        table: check.table ?? [],
    };
}

export type Fix = { label: string; done: string; cleanup: Partial<Cleanup>; step: Step };

export type FixEffect = { done: string; before: number; after: number | null };

const SHOWN = new Set(["duplicates", "conflicts", "balance", "length", "personal_data"]);
const RANK: Record<CheckInfo["status"], number> = {
    blocked: 0,
    warning: 1,
    skipped: 3,
    off: 4,
    ok: 5,
};

function percent(share: number): string {
    return `${(share * 100).toFixed(share < 0.1 ? 1 : 0)}%`;
}

function rowsText(value: number): string {
    return `${count(value)} ${value === 1 ? "row" : "rows"}`;
}

function rank(check: Finding): number {
    return RANK[check.status] + (check.status === "warning" && check.handled ? 1 : 0);
}

export function openFindings(checks: CheckInfo[]): Finding[] {
    return checks
        .map(findingOf)
        .filter(
            (check) =>
                (check.status === "warning" || check.status === "blocked") && !check.dismissed,
        )
        .sort((left, right) => rank(left) - rank(right) || right.rows - left.rows);
}

export function toLookAt(checks: CheckInfo[]): Finding[] {
    return openFindings(checks).filter((check) => check.status === "warning" && !check.handled);
}

export function toneOf(check: Finding): Tone {
    if (check.status === "blocked") {
        return "destructive";
    }
    if (check.status === "warning") {
        return check.handled ? "info" : "warning";
    }
    return check.status === "ok" ? "success" : "neutral";
}

function blockedText(check: CheckInfo): string {
    if (check.check === "single_label") {
        return "Can't train: only one label";
    }
    return check.count > 0
        ? "Can't train: too few rows"
        : "Can't train: no rows with an input and an answer";
}

export function verdictOf(checks: CheckInfo[]): { tone: Tone; text: string } {
    const blocked = checks.find((check) => check.status === "blocked");
    if (blocked) {
        return { tone: "destructive", text: blockedText(blocked) };
    }
    const open = toLookAt(checks).length;
    return open > 0
        ? { tone: "warning", text: `${open} to look at` }
        : { tone: "success", text: "Ready to train" };
}

function Facts({ shape }: { shape: QueryShape }) {
    const quality = shape.quality;
    if (!quality) {
        return null;
    }
    const facts: [string, string][] = [
        ["Rows", count(shape.rows)],
        ["Labels", count(quality.labels)],
        ["Largest label", shape.largest_share === null ? "–" : percent(shape.largest_share)],
        ["Empty", count(quality.empty)],
        ["Repeated", count(quality.duplicates)],
    ];
    return (
        <dl className="grid grid-cols-[max-content_minmax(0,1fr)_max-content_minmax(0,1fr)] gap-x-4 gap-y-1.5 tabular-nums">
            {facts.map(([label, value]) => (
                <div key={label} className="contents">
                    <dt className="text-muted-foreground">{label}</dt>
                    <dd>{value}</dd>
                </div>
            ))}
        </dl>
    );
}

function Threshold({ check, limits }: { check: Finding; limits: Limits | null }) {
    const person = usePerson();
    if (!limits) {
        return null;
    }
    const text =
        check.check === "balance"
            ? `Rare = fewer than ${count(limits.minLabelRows)} rows · too large = over ${percent(limits.majorityShare)} of rows`
            : check.check === "length" && check.columns.length > 0
              ? `Long = over ${count(limits.longTokens)} tokens, about ${limits.charsPerToken} characters a token`
              : null;
    if (!text) {
        return null;
    }
    return (
        <p className="text-sm text-muted-foreground tabular-nums">
            {text}
            {allows(person?.role, "admin") && check.check === "balance" && (
                <>
                    {" · "}
                    <Link
                        href="/settings/data"
                        className="whitespace-nowrap text-primary hover:underline"
                    >
                        Settings › Data
                    </Link>
                </>
            )}
        </p>
    );
}

function Examples({ check }: { check: Finding }) {
    if (check.columns.length === 0 || check.table.length === 0) {
        return null;
    }
    const last = check.columns.length - 1;
    return (
        <div className="overflow-hidden rounded-md border">
            <Table className="table-fixed">
                <TableHeader>
                    <TableRow className="hover:bg-transparent">
                        {check.columns.map((column, index) => (
                            <TableHead
                                key={column}
                                className={
                                    index === 0
                                        ? undefined
                                        : index === last
                                          ? "w-40 text-right"
                                          : "w-40"
                                }
                            >
                                {column}
                            </TableHead>
                        ))}
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {check.table.map((cells) => (
                        <TableRow key={cells.join("\u0000")} className="last:border-b-0">
                            {cells.map((cell, index) => (
                                <TableCell
                                    key={check.columns[index] ?? index}
                                    className={
                                        index === last && index > 0
                                            ? "text-right text-muted-foreground"
                                            : "max-w-0 truncate"
                                    }
                                    title={cell}
                                >
                                    {cell}
                                </TableCell>
                            ))}
                        </TableRow>
                    ))}
                </TableBody>
            </Table>
        </div>
    );
}

export type FixContext = {
    limits: Limits | null;
    perLabel: number;
    rare: boolean;
};

function fixesFor(check: Finding, context: FixContext, perLabel: number): Fix[] {
    const { limits } = context;
    switch (check.check) {
        case "conflicts":
            return [
                {
                    label: "Keep the most common label",
                    done: "Kept the most common label of each input",
                    cleanup: { conflicts: "common" },
                    step: conflictsStep("common"),
                },
                {
                    label: "Drop those inputs",
                    done: "Dropped inputs with more than one label",
                    cleanup: { conflicts: "drop" },
                    step: conflictsStep("drop"),
                },
            ];
        case "balance": {
            const found: Fix[] = [];
            if (context.rare && limits) {
                found.push({
                    label: `Drop labels under ${count(limits.minLabelRows)} rows`,
                    done: `Dropped labels under ${count(limits.minLabelRows)} rows`,
                    cleanup: { rare: limits.minLabelRows },
                    step: rareStep(limits.minLabelRows),
                });
            }
            found.push({
                label: `Keep at most ${count(perLabel)} a label`,
                done: `Kept at most ${count(perLabel)} rows a label`,
                cleanup: { per_label: perLabel },
                step: perLabelStep(perLabel),
            });
            return found;
        }
        case "length":
            return limits && check.columns.length > 0
                ? [
                      {
                          label: `Drop inputs over ${count(limits.longTokens)} tokens`,
                          done: `Dropped inputs over ${count(limits.longTokens)} tokens`,
                          cleanup: { max_tokens: limits.longTokens },
                          step: longStep(limits.longTokens, limits.charsPerToken),
                      },
                  ]
                : [];
        case "personal_data":
            return [
                {
                    label: "Mask them",
                    done: "Masked emails, phone numbers, card numbers and IBANs",
                    cleanup: { personal_data: "mask" },
                    step: personalStep("mask"),
                },
                {
                    label: "Drop those rows",
                    done: "Dropped rows with personal data",
                    cleanup: { personal_data: "drop" },
                    step: personalStep("drop"),
                },
            ];
        default:
            return [];
    }
}

function FindingRow({
    check,
    total,
    context,
    actionable,
    dismiss,
    onShowRows,
    onFix,
}: {
    check: Finding;
    total: number;
    context: FixContext;
    actionable: boolean;
    dismiss: ReturnType<typeof useDismiss> | null;
    onShowRows: (check: Finding) => void;
    onFix: (fix: Fix) => void;
}) {
    const [perLabel, setPerLabel] = useState(context.perLabel);
    const fixes = actionable ? fixesFor(check, context, perLabel) : [];
    const showable = actionable && SHOWN.has(check.check) && check.rows > 0;
    return (
        <li className="flex flex-col gap-2 px-4 py-3">
            <div className="flex min-h-8 flex-wrap items-center gap-x-3 gap-y-1">
                <span className="flex min-w-0 flex-1 items-center gap-2">
                    <StatusDot tone={toneOf(check)} />
                    <span className="font-medium">{check.title}</span>
                    {check.rows > 0 && (
                        <span className="shrink-0 text-sm whitespace-nowrap text-muted-foreground tabular-nums">
                            {`${rowsText(check.rows)} · ${percent(check.rows / Math.max(total, 1))}`}
                        </span>
                    )}
                </span>
                {showable && (
                    <Button variant="ghost" size="sm" onClick={() => onShowRows(check)}>
                        <IconEye />
                        Show rows
                    </Button>
                )}
                {dismiss && check.status === "warning" && !check.handled && (
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <Button
                                variant="ghost"
                                size="icon-sm"
                                aria-label={`Dismiss ${check.title} for this dataset`}
                                disabled={dismiss.dismiss.isPending}
                                onClick={() => dismiss.dismiss.mutate(check)}
                            >
                                <IconX />
                            </Button>
                        </TooltipTrigger>
                        <TooltipContent>Dismiss for this dataset</TooltipContent>
                    </Tooltip>
                )}
            </div>
            <p className="text-sm text-muted-foreground">
                {check.handled ? `${check.detail} Nothing to fix.` : check.detail}
            </p>
            <Threshold check={check} limits={context.limits} />
            <Examples check={check} />
            {fixes.length > 0 && (
                <div className="flex flex-wrap items-center gap-2">
                    {fixes.map((fix) => (
                        <span key={fix.label} className="inline-flex items-center gap-2">
                            {fix.cleanup.per_label !== undefined && (
                                <NumberField
                                    aria-label="Rows a label"
                                    value={perLabel}
                                    min={1}
                                    max={50_000_000}
                                    format={{ maximumFractionDigits: 0 }}
                                    onValueChange={(value) => value !== null && setPerLabel(value)}
                                    className="w-32"
                                    groupClassName="w-full"
                                />
                            )}
                            <Button variant="outline" size="sm" onClick={() => onFix(fix)}>
                                {fix.label}
                            </Button>
                        </span>
                    ))}
                </div>
            )}
        </li>
    );
}

function Effect({ effect }: { effect: FixEffect }) {
    const change = effect.after === null ? null : effect.after - effect.before;
    return (
        <p className="flex flex-wrap items-center gap-x-2 tabular-nums">
            <StatusText tone="success">{effect.done}</StatusText>
            <span className="text-muted-foreground">
                {change === null
                    ? "Running…"
                    : change === 0
                      ? "No rows dropped"
                      : `${change < 0 ? "−" : "+"}${rowsText(Math.abs(change))} · ${count(effect.before)} → ${count(effect.after)}`}
            </span>
        </p>
    );
}

function Settled({
    checks,
    dismiss,
}: {
    checks: CheckInfo[];
    dismiss: ReturnType<typeof useDismiss> | null;
}) {
    const passed = checks.filter((check) => check.status === "ok");
    const unchecked = checks.filter(
        (check) => check.status === "skipped" || check.status === "off",
    );
    const dismissed = checks.filter((check) => check.dismissed);
    return (
        <div className="flex flex-col gap-1">
            {passed.length > 0 && (
                <Collapsible>
                    <CollapsibleTrigger className="flex min-h-8 items-center gap-1.5 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring">
                        <StatusText tone="success">{`${passed.length} passed`}</StatusText>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                        <ul className="flex flex-col gap-2 pt-1 pb-2 pl-5">
                            {passed.map((check) => (
                                <li key={check.check} className="flex flex-col">
                                    <span>{check.title}</span>
                                    <span className="text-sm text-muted-foreground">
                                        {check.detail}
                                    </span>
                                </li>
                            ))}
                        </ul>
                    </CollapsibleContent>
                </Collapsible>
            )}
            {unchecked.map((check) => (
                <p key={check.check} className="flex min-h-8 items-center gap-2">
                    <StatusDot tone="muted" />
                    <span>{check.title}</span>
                    <span
                        className="min-w-0 truncate text-sm text-muted-foreground"
                        title={check.detail}
                    >
                        {check.detail}
                    </span>
                </p>
            ))}
            {dismissed.map((check) => (
                <p key={check.check} className="flex min-h-8 items-center gap-2">
                    <span className="min-w-0 truncate text-muted-foreground">{`Dismissed: ${check.title}`}</span>
                    {dismiss && (
                        <Button
                            variant="link"
                            className="h-auto shrink-0 px-0"
                            disabled={dismiss.restore.isPending}
                            onClick={() => dismiss.restore.mutate(check)}
                        >
                            Show again
                        </Button>
                    )}
                </p>
            ))}
        </div>
    );
}

export function QualityTab({
    shape,
    counting,
    dataset,
    actionable,
    context,
    effect,
    onShowRows,
    onFix,
}: {
    shape: QueryShape | undefined;
    counting: boolean;
    dataset: string | null;
    actionable: boolean;
    context: FixContext;
    effect: FixEffect | null;
    onShowRows: (check: Finding) => void;
    onFix: (fix: Fix) => void;
}) {
    const dismissing = useDismiss(dataset ?? "");
    const dismiss = dataset ? dismissing : null;
    if (!shape?.quality || !shape.checks) {
        return (
            <p className="px-3 py-2 text-muted-foreground">
                {counting
                    ? "Checking rows…"
                    : "Run a query that returns input and label to check its rows."}
            </p>
        );
    }
    const checks = shape.checks;
    const open = openFindings(checks);
    const total = shape.checked ?? shape.rows;
    return (
        <div className="flex flex-col gap-4 p-4">
            {effect && <Effect effect={effect} />}
            <Facts shape={shape} />
            {shape.checked !== null &&
                shape.checked !== undefined &&
                shape.checked < shape.rows && (
                    <p className="text-sm text-muted-foreground tabular-nums">
                        {`The checks read a random ${count(shape.checked)} of the ${count(shape.rows)} rows; their counts are for those rows.`}
                    </p>
                )}
            {open.length > 0 && (
                <ul className="flex flex-col divide-y rounded-lg border">
                    {open.map((check) => (
                        <FindingRow
                            key={check.check}
                            check={check}
                            total={total}
                            context={context}
                            actionable={actionable}
                            dismiss={dismiss}
                            onShowRows={onShowRows}
                            onFix={onFix}
                        />
                    ))}
                </ul>
            )}
            <Settled checks={checks} dismiss={dismiss} />
            <p className="text-sm text-muted-foreground">
                Train and test overlap is checked when the version is saved.
            </p>
            <ErrorLine error={dismissing.dismiss.error ?? dismissing.restore.error} />
        </div>
    );
}
