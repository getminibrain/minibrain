import { IconCheck, IconX } from "@tabler/icons-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
    Button,
    Collapsible,
    CollapsibleContent,
    CollapsibleTrigger,
    Link,
    Tooltip,
    TooltipContent,
    TooltipTrigger,
} from "obp-ui";
import { api, succeed } from "~/api/client";
import type { DatasetVersionInfo } from "~/api/dataQueries";
import type { components } from "~/api/schema";
import { ErrorLine } from "~/components/Section";
import { StatusText, type Tone } from "~/components/models/StatusText";
import { relativeTime } from "~/lib/time";
import { itemHref } from "./catalogue";

type CheckInfo = components["schemas"]["CheckInfo"];
type CheckName = NonNullable<components["schemas"]["DataSettings"]["checks_off"]>[number];

const TONES: Record<CheckInfo["status"], Tone> = {
    ok: "success",
    warning: "warning",
    blocked: "destructive",
    off: "neutral",
    skipped: "neutral",
};

const ORDER: CheckInfo["status"][] = ["blocked", "warning", "skipped", "off", "ok"];

export function keyedByText<T>(items: T[], text: (item: T) => string) {
    const seen = new Map<string, number>();
    return items.map((item) => {
        const base = text(item);
        const repeat = seen.get(base) ?? 0;
        seen.set(base, repeat + 1);
        return { key: `${base}\u0000${repeat}`, item };
    });
}

export function useDismiss(dataset: string) {
    const client = useQueryClient();
    const refresh = () =>
        Promise.all([
            client.invalidateQueries({ queryKey: ["datasets"] }),
            client.invalidateQueries({ queryKey: ["model"] }),
            client.invalidateQueries({ queryKey: ["query-preview"] }),
        ]);
    const dismiss = useMutation({
        mutationFn: (check: CheckInfo) =>
            succeed(
                api.PUT("/api/datasets/{slug}/checks/{check}/dismissal", {
                    params: { path: { slug: dataset, check: check.check as CheckName } },
                    body: { signature: check.signature },
                }),
            ),
        onSuccess: refresh,
    });
    const restore = useMutation({
        mutationFn: (check: CheckInfo) =>
            succeed(
                api.DELETE("/api/datasets/{slug}/checks/{check}/dismissal", {
                    params: { path: { slug: dataset, check: check.check as CheckName } },
                }),
            ),
        onSuccess: refresh,
    });
    return { dismiss, restore };
}

function Finding({
    check,
    dataset,
    actions,
}: {
    check: CheckInfo;
    dataset: string | null;
    actions: ReturnType<typeof useDismiss> | null;
}) {
    return (
        <li className="flex flex-col gap-1 px-4 py-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <StatusText tone={TONES[check.status]} className="font-medium">
                    {check.title}
                </StatusText>
                {dataset && actions && check.status === "warning" && (
                    <Button
                        variant="ghost"
                        size="sm"
                        disabled={actions.dismiss.isPending}
                        onClick={() => actions.dismiss.mutate(check)}
                    >
                        Dismiss for this dataset
                    </Button>
                )}
            </div>
            <p className="text-sm text-muted-foreground">{check.detail}</p>
            {check.examples.length > 0 && (
                <ul className="flex flex-col gap-0.5">
                    {keyedByText(check.examples, String).map(({ key, item: example }) => (
                        <li key={key} className="truncate">
                            {example}
                        </li>
                    ))}
                </ul>
            )}
        </li>
    );
}

export function ChecksReport({
    datasetVersion,
    dataset,
}: {
    datasetVersion: DatasetVersionInfo;
    dataset: string | null;
}) {
    const actions = useDismiss(dataset ?? "");
    const checks = [...(datasetVersion.checks ?? [])].sort(
        (left, right) => ORDER.indexOf(left.status) - ORDER.indexOf(right.status),
    );
    const open = checks.filter((check) => check.status !== "ok" && !check.dismissed);
    const dismissed = checks.filter((check) => check.dismissed);
    const passed = checks.filter((check) => check.status === "ok");
    if (checks.length === 0) {
        return (
            <p className="text-muted-foreground">
                This version was saved before checks ran. The next one carries a report.
            </p>
        );
    }
    return (
        <div className="flex flex-col gap-3">
            {open.length > 0 && (
                <ul className="flex flex-col divide-y rounded-lg border">
                    {open.map((check) => (
                        <Finding
                            key={check.check}
                            check={check}
                            dataset={dataset}
                            actions={dataset ? actions : null}
                        />
                    ))}
                </ul>
            )}
            {passed.length > 0 && (
                <p>
                    <StatusText tone="success">Passed</StatusText>
                    <span className="ml-2 text-muted-foreground">
                        {passed.map((check) => check.title).join(" · ")}
                    </span>
                </p>
            )}
            {dismissed.length > 0 && (
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="text-muted-foreground">Dismissed for this dataset:</span>
                    {dismissed.map((check) => (
                        <span key={check.check} className="inline-flex items-center gap-1">
                            <span>{check.title}</span>
                            <Button
                                variant="link"
                                className="h-auto px-0"
                                disabled={actions.restore.isPending}
                                onClick={() => actions.restore.mutate(check)}
                            >
                                Show again
                            </Button>
                        </span>
                    ))}
                </div>
            )}
            <ErrorLine error={actions.dismiss.error ?? actions.restore.error} />
        </div>
    );
}

function CompactFinding({
    check,
    actions,
}: {
    check: CheckInfo;
    actions: ReturnType<typeof useDismiss> | null;
}) {
    return (
        <li className="group/finding flex flex-col">
            <Collapsible>
                <div className="flex min-h-8 items-center gap-2">
                    <CollapsibleTrigger className="min-w-0 flex-1 font-normal">
                        <StatusText tone={TONES[check.status]} className="min-w-0">
                            <span className="truncate">{check.title}</span>
                        </StatusText>
                    </CollapsibleTrigger>
                    {actions && check.status === "warning" && (
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button
                                    variant="ghost"
                                    size="icon-sm"
                                    aria-label={`Dismiss ${check.title}`}
                                    disabled={actions.dismiss.isPending}
                                    onClick={() => actions.dismiss.mutate(check)}
                                    className="opacity-0 group-hover/finding:opacity-100 focus-visible:opacity-100"
                                >
                                    <IconX />
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent>Dismiss</TooltipContent>
                        </Tooltip>
                    )}
                </div>
                <CollapsibleContent className="flex flex-col gap-1 pb-1 pl-5">
                    <p className="text-sm text-muted-foreground">{check.detail}</p>
                    {check.examples.length > 0 && (
                        <ul className="flex flex-col gap-0.5">
                            {keyedByText(check.examples, String).map(({ key, item: example }) => (
                                <li key={key} className="truncate">
                                    {example}
                                </li>
                            ))}
                        </ul>
                    )}
                </CollapsibleContent>
            </Collapsible>
        </li>
    );
}

export function ChecksList({
    datasetVersion,
    dataset,
    readOnly = false,
}: {
    datasetVersion: DatasetVersionInfo | null | undefined;
    dataset: string;
    readOnly?: boolean;
}) {
    const dismissing = useDismiss(dataset);
    const actions = readOnly ? null : dismissing;
    if (!datasetVersion) {
        return <p className="text-muted-foreground">Checks run when a version is saved.</p>;
    }
    const checks = [...(datasetVersion.checks ?? [])].sort(
        (left, right) => ORDER.indexOf(left.status) - ORDER.indexOf(right.status),
    );
    if (checks.length === 0) {
        return (
            <p className="text-muted-foreground">
                This version was saved before checks ran. The next one carries a report.
            </p>
        );
    }
    const open = checks.filter((check) => check.status !== "ok" && !check.dismissed);
    const dismissed = checks.filter((check) => check.dismissed);
    const passed = checks.filter((check) => check.status === "ok");
    return (
        <div className="flex flex-col gap-1">
            {open.length > 0 && (
                <ul className="flex flex-col">
                    {open.map((check) => (
                        <CompactFinding key={check.check} check={check} actions={actions} />
                    ))}
                </ul>
            )}
            {passed.length > 0 && (
                <Collapsible>
                    <CollapsibleTrigger className="flex min-h-8 items-center gap-1.5 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring">
                        <StatusText tone="success">{`${passed.length} passed`}</StatusText>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                        <ul className="flex flex-col gap-2 pt-1 pb-2">
                            {passed.map((check) => (
                                <li key={check.check} className="flex gap-2">
                                    <IconCheck
                                        aria-hidden="true"
                                        className="mt-0.5 size-4 shrink-0 text-success"
                                    />
                                    <span className="flex min-w-0 flex-col">
                                        <span>{check.title}</span>
                                        {check.detail && (
                                            <span className="text-sm text-muted-foreground">
                                                {check.detail}
                                            </span>
                                        )}
                                    </span>
                                </li>
                            ))}
                        </ul>
                    </CollapsibleContent>
                </Collapsible>
            )}
            {dismissed.map((check) => (
                <p key={check.check} className="flex min-h-8 items-center gap-2">
                    <span className="min-w-0 truncate text-muted-foreground">
                        {`Dismissed: ${check.title}`}
                    </span>
                    {actions && (
                        <Button
                            variant="link"
                            className="h-auto shrink-0 px-0"
                            disabled={actions.restore.isPending}
                            onClick={() => actions.restore.mutate(check)}
                        >
                            Show again
                        </Button>
                    )}
                </p>
            ))}
            <ErrorLine error={dismissing.dismiss.error ?? dismissing.restore.error} />
        </div>
    );
}

export function checksCaption(datasetVersion: DatasetVersionInfo | null | undefined): string {
    return datasetVersion
        ? `On version ${datasetVersion.number ?? "–"}, saved ${relativeTime(datasetVersion.taken_at ?? datasetVersion.created_at)}. Warnings do not block training. Turn checks on or off under Settings, Data.`
        : "";
}

export function ModelChecks({
    datasetVersion,
}: { datasetVersion: DatasetVersionInfo | null | undefined }) {
    const all = datasetVersion?.checks ?? [];
    if (!datasetVersion || all.length === 0) {
        return null;
    }
    const open = all.filter(
        (check) => check.status !== "ok" && check.status !== "off" && !check.dismissed,
    );
    return (
        <div className="mb-4 flex flex-col gap-2">
            <p className="text-muted-foreground">
                {open.length === 0
                    ? `Checks on version ${datasetVersion.number ?? "–"} passed.`
                    : `Checks on version ${datasetVersion.number ?? "–"} found ${open.length === 1 ? "one thing" : `${open.length} things`} to look at. Training still runs.`}
                {datasetVersion.dataset && (
                    <>
                        {" "}
                        <Link
                            href={itemHref({ kind: "dataset", id: datasetVersion.dataset })}
                            className="text-primary hover:underline"
                        >
                            Open the dataset
                        </Link>
                    </>
                )}
            </p>
            {open.length > 0 && (
                <ChecksReport datasetVersion={datasetVersion} dataset={datasetVersion.dataset} />
            )}
        </div>
    );
}
