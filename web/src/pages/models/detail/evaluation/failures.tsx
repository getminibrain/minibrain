import { IconZoomCancel } from "@tabler/icons-react";
import type { ColumnDef } from "@tanstack/react-table";
import {
    DataGrid,
    SegmentedTabs,
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
    cn,
} from "obp-ui";
import { useState } from "react";
import type { ExampleAnswer, ModelRow, VersionInfo } from "~/api/client";
import { ErrorLine, PanelSection } from "~/components/Section";
import { count, percent } from "~/lib/format";
import { isDeployed } from "../header";
import { liveOf, versionLabel } from "../makeLive";
import { LabelBar, inputOf, useAnswers, verdictOf, worstLabels } from "../versionChanges";
import { AnswerSheet, type Change, type FailureRow, rightOf } from "./answerSheet";
import { scoredVersions } from "./scores";

type Mode = "wrong" | "changed" | "labels";

const HEIGHT = "h-112";

function changeOf(answer: ExampleAnswer, metric: string | null | undefined): Change | null {
    const verdict = verdictOf(answer, metric);
    if (verdict === "same") {
        return null;
    }
    const mine = rightOf(answer.version.scores, metric);
    const theirs = answer.live ? rightOf(answer.live.scores, metric) : null;
    if (verdict === "better") {
        return mine === true && theirs === false ? "newly right" : "better";
    }
    return mine === false && theirs === true ? "newly wrong" : "worse";
}

function failuresOf(
    answers: ExampleAnswer[],
    metric: string | null | undefined,
    mode: Mode,
): FailureRow[] {
    return answers.flatMap((answer, index): FailureRow[] => {
        if (mode === "changed") {
            const change = changeOf(answer, metric);
            return change ? [{ id: String(index), answer, change }] : [];
        }
        return rightOf(answer.version.scores, metric) === false
            ? [{ id: String(index), answer, change: null }]
            : [];
    });
}

function Clipped({ text, tone }: { text: string; tone?: string }) {
    return (
        <span title={text} className={cn("block max-w-72 truncate", tone)}>
            {text || "–"}
        </span>
    );
}

function sentence(text: string): string {
    return `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
}

const CHANGE_TONE: Record<Change, string> = {
    "newly right": "text-success",
    better: "text-success",
    "newly wrong": "text-destructive",
    worse: "text-destructive",
};

const CHANGE_RANK: Record<Change, number> = {
    "newly wrong": 0,
    worse: 1,
    better: 2,
    "newly right": 3,
};

function columnsFor(
    metric: string | null | undefined,
    mode: Mode,
    picked: number,
    against: number | null,
): ColumnDef<FailureRow, unknown>[] {
    const input: ColumnDef<FailureRow, unknown> = {
        id: "input",
        header: "Input",
        enableHiding: false,
        enableSorting: false,
        accessorFn: (item) => inputOf(item.answer),
        cell: ({ row }) => <Clipped text={inputOf(row.original.answer)} />,
    };
    const expected: ColumnDef<FailureRow, unknown> = {
        id: "expected",
        header: "Expected",
        accessorFn: (item) => item.answer.expected,
        cell: ({ row }) => <Clipped text={row.original.answer.expected} />,
    };
    const actual: ColumnDef<FailureRow, unknown> = {
        id: "actual",
        header: mode === "changed" ? `v${picked}` : "Answer",
        accessorFn: (item) => item.answer.version.answer,
        cell: ({ row }) => <Clipped text={row.original.answer.version.answer} />,
    };
    if (mode === "changed") {
        return [
            input,
            expected,
            actual,
            {
                id: "deployed",
                header: against === null ? "Deployed" : `Deployed v${against}`,
                accessorFn: (item) => item.answer.live?.answer ?? "",
                cell: ({ row }) => <Clipped text={row.original.answer.live?.answer ?? ""} />,
            },
            {
                id: "change",
                header: "Change",
                accessorFn: (item) => (item.change ? CHANGE_RANK[item.change] : undefined),
                sortUndefined: "last",
                cell: ({ row }) => {
                    const change = row.original.change;
                    return change ? (
                        <span className={CHANGE_TONE[change]}>{sentence(change)}</span>
                    ) : null;
                },
            },
        ];
    }
    return [
        input,
        expected,
        actual,
        {
            id: "verdict",
            header: "Verdict",
            accessorFn: (item) => (metric ? (item.answer.version.scores[metric] ?? 0) : 0),
            cell: ({ row }) => {
                const side = row.original.answer.version;
                const score = metric ? side.scores[metric] : undefined;
                return (
                    <span className="flex min-w-0 items-baseline gap-2">
                        <span className="text-destructive tabular-nums">
                            {score === undefined || score === 0 ? "Wrong" : percent(score)}
                        </span>
                        {side.reason && <Clipped text={side.reason} tone="text-muted-foreground" />}
                    </span>
                );
            },
        },
    ];
}

function VersionPicker({
    versions,
    value,
    deployed,
    onChange,
}: {
    versions: VersionInfo[];
    value: number;
    deployed: number | null;
    onChange: (number: number) => void;
}) {
    return (
        <Select value={String(value)} onValueChange={(next) => onChange(Number(next ?? value))}>
            <SelectTrigger aria-label="Version" className="w-56">
                <SelectValue />
            </SelectTrigger>
            <SelectContent>
                {versions.map((version) => (
                    <SelectItem key={version.number} value={String(version.number)}>
                        {[
                            versionLabel(version),
                            percent(version.score),
                            version.number === deployed ? "deployed" : null,
                        ]
                            .filter(Boolean)
                            .join(" · ")}
                    </SelectItem>
                ))}
            </SelectContent>
        </Select>
    );
}

function emptyText(mode: Mode, picked: number, against: number | null, rowsKnown: boolean): string {
    if (!rowsKnown) {
        return `Per-row results aren't available for v${picked}.`;
    }
    if (mode === "changed") {
        return `v${picked} answers every held-out row the way deployed v${against} does.`;
    }
    return `v${picked} gets every held-out row right.`;
}

function ByLabel({ version, reference }: { version: VersionInfo; reference: VersionInfo | null }) {
    const labels = worstLabels(version, reference);
    if (labels.length === 0) {
        return (
            <div
                className={cn(
                    HEIGHT,
                    "flex items-center justify-center rounded-md border px-3 text-muted-foreground",
                )}
            >
                {`Per-label results aren't available for v${version.number}.`}
            </div>
        );
    }
    return (
        <ul
            className={cn(
                HEIGHT,
                "flex flex-col gap-1 overflow-auto rounded-md border px-3 py-2.5",
            )}
            aria-label={`Recall by label for v${version.number}, worst first`}
        >
            {labels.map((change) => (
                <LabelBar
                    key={change.label}
                    change={change}
                    mine={`v${version.number}`}
                    theirs={reference ? `deployed v${reference.number}` : null}
                />
            ))}
        </ul>
    );
}

function tipFor(mode: Mode, picked: VersionInfo | undefined, shown: number, total: number) {
    if (!picked) {
        return "Held-out rows the latest scored version gets wrong.";
    }
    if (mode === "labels") {
        return `Recall per label for v${picked.number} on held-out rows, worst first.`;
    }
    const counted = total > 0 ? `: ${count(shown)} of ${count(total)}` : "";
    return `Held-out rows v${picked.number} does not get fully right${counted}. Open a row for the whole conversation and the grader's reason.`;
}

export function FailuresPanel({ row, versions }: { row: ModelRow; versions: VersionInfo[] }) {
    const scored = scoredVersions(versions).reverse();
    const deployed = isDeployed(row) ? liveOf(versions) : undefined;
    const [chosen, setChosen] = useState<number | null>(null);
    const [wanted, setWanted] = useState<Mode>("wrong");
    const [open, setOpen] = useState<FailureRow | null>(null);
    const picked = scored.find((version) => version.number === chosen) ?? scored[0];
    const comparable =
        picked !== undefined &&
        deployed !== undefined &&
        deployed.score !== null &&
        deployed.number !== picked.number;
    const mode: Mode = comparable || wanted !== "changed" ? wanted : "wrong";
    const against = mode === "changed" && deployed ? deployed.number : null;
    const answers = useAnswers(row.key, picked?.number ?? 0, against, picked !== undefined);
    const metric = answers.data?.metric;
    const all = answers.data?.examples ?? [];
    const rows = failuresOf(all, metric, mode);
    const rowsKnown = answers.isSuccess && all.length > 0;
    const tabs = [
        { key: "wrong", label: "Wrong" },
        ...(comparable ? [{ key: "changed", label: `Changed vs v${deployed.number}` }] : []),
        { key: "labels", label: "By label" },
    ];
    return (
        <PanelSection
            icon={IconZoomCancel}
            anchor="failures"
            title="Where it fails"
            tip={tipFor(mode, picked, rows.length, all.length)}
            actions={
                picked && (
                    <div className="flex flex-wrap items-center gap-2">
                        <SegmentedTabs
                            tabs={tabs}
                            active={mode}
                            onSelect={(next) =>
                                setWanted(next === "changed" || next === "labels" ? next : "wrong")
                            }
                        />
                        <VersionPicker
                            versions={scored}
                            value={picked.number}
                            deployed={deployed?.number ?? null}
                            onChange={setChosen}
                        />
                    </div>
                )
            }
            bare
        >
            <div className="flex flex-col gap-2">
                {mode === "labels" && picked ? (
                    <ByLabel
                        version={picked}
                        reference={comparable && deployed ? deployed : null}
                    />
                ) : (
                    <DataGrid
                        className={HEIGHT}
                        columns={columnsFor(metric, mode, picked?.number ?? 0, against)}
                        rows={rows}
                        loading={answers.isLoading}
                        getRowId={(item) => item.id}
                        onOpen={setOpen}
                        rowLabel={(item) => `Held-out row ${inputOf(item.answer)}`}
                        maxHeight="28rem"
                        empty={
                            picked
                                ? emptyText(mode, picked.number, against, rowsKnown)
                                : "No version scored yet."
                        }
                    />
                )}
                {mode !== "labels" && <ErrorLine error={answers.error} onRetry={answers.refetch} />}
            </div>
            <AnswerSheet
                row={open}
                metric={metric}
                picked={picked?.number ?? 0}
                against={against}
                onClose={() => setOpen(null)}
            />
        </PanelSection>
    );
}
