import { IconArrowRight, IconCube } from "@tabler/icons-react";
import { useRouter } from "@tanstack/react-router";
import type { ColumnDef } from "@tanstack/react-table";
import { Button, DataGrid, Link } from "obp-ui";
import type { NextAction } from "~/api/client";
import { useModelPage } from "~/api/queries";
import { SectionError } from "~/components/ErrorState";
import { FLUSH_GRID, PanelSection } from "~/components/Section";
import { Latency, Requests } from "~/components/models/ModelMetrics";
import { useCan } from "~/lib/access";
import { modelPageHref, trainHref } from "~/lib/modelLinks";
import { ModelAvatar, Muted, ScoreGain, StatusLineText } from "~/pages/models/list/cells";
import {
    type ListModel,
    baselineOf,
    deployed,
    headlineOf,
    hrefOf,
    liveOf,
    pct,
    replicasOf,
    statusLine,
    usageOf,
} from "~/pages/models/list/model";
import { type HomeData, SHOWN_MODELS } from "./data";

function nextHref(model: ListModel, next: NextAction): string {
    const key = model.row.key;
    if (next.kind === "review_feedback") {
        return `/feedback?model=${encodeURIComponent(key)}&status=pending`;
    }
    if (next.kind === "train" || next.kind === "add_data") {
        return trainHref(key);
    }
    return modelPageHref(key);
}

function nextText(next: NextAction): string {
    if (next.kind === "promote" && next.version !== null && next.version !== undefined) {
        return `Deploy v${next.version}`;
    }
    return next.label;
}

function NextCell({ model }: { model: ListModel }) {
    const next = useModelPage(model.row.key).data?.next;
    if (!next) {
        return <Muted />;
    }
    return (
        <Link
            href={nextHref(model, next)}
            className="relative z-10 inline-flex max-w-full items-center gap-1 truncate font-medium text-primary hover:underline"
        >
            <span className="truncate">{nextText(next)}</span>
            <IconArrowRight aria-hidden="true" className="size-4 shrink-0" />
        </Link>
    );
}

function NameCell({ model }: { model: ListModel }) {
    const detail = model.kind === "custom" ? model.baseName : model.row.publisher;
    return (
        <span className="flex min-w-0 items-center gap-3">
            <ModelAvatar model={model} />
            <span className="flex min-w-0 flex-col">
                <Link
                    href={hrefOf(model)}
                    className="truncate font-medium text-foreground hover:underline"
                >
                    {model.name}
                </Link>
                {detail && <span className="truncate text-sm text-muted-foreground">{detail}</span>}
            </span>
        </span>
    );
}

function ScoreCell({ model }: { model: ListModel }) {
    const headline = headlineOf(model);
    if (!headline || headline.score == null) {
        return <Muted />;
    }
    const baseline = baselineOf(model);
    const versus = baseline && baseline.number !== headline.number ? baseline : undefined;
    return (
        <span className="flex flex-col tabular-nums">
            <span
                className={liveOf(model) ? "font-semibold" : "font-semibold text-muted-foreground"}
            >
                {`${pct(headline.score)} · v${headline.number}`}
            </span>
            {versus?.score != null && (
                <ScoreGain value={headline.score - versus.score} versus="v0" />
            )}
        </span>
    );
}

const COLUMNS: ColumnDef<ListModel, unknown>[] = [
    {
        id: "model",
        header: "Model",
        size: 260,
        accessorFn: (model) => model.name.toLowerCase(),
        cell: ({ row }) => <NameCell model={row.original} />,
    },
    {
        id: "state",
        header: "State",
        size: 200,
        enableSorting: false,
        cell: ({ row }) => (
            <StatusLineText line={statusLine(row.original)} replicas={replicasOf(row.original)} />
        ),
    },
    {
        id: "score",
        header: "Score",
        size: 150,
        accessorFn: (model) => headlineOf(model)?.score ?? -1,
        cell: ({ row }) => <ScoreCell model={row.original} />,
    },
    {
        id: "requests",
        header: "Requests, 7 days",
        size: 200,
        accessorFn: (model) => usageOf(model)?.total ?? 0,
        cell: ({ row }) => <Requests usage={usageOf(row.original)} live={deployed(row.original)} />,
    },
    {
        id: "latency",
        header: "p50",
        size: 90,
        accessorFn: (model) => usageOf(model)?.p50_ms ?? -1,
        cell: ({ row }) => <Latency usage={usageOf(row.original)} />,
    },
    {
        id: "next",
        header: "Next step",
        size: 200,
        enableSorting: false,
        cell: ({ row }) => <NextCell model={row.original} />,
    },
];

export function ModelsPanel({ data }: { data: HomeData }) {
    const can = useCan();
    const router = useRouter();
    const rows = data.shown.slice(0, SHOWN_MODELS);
    const hidden = can.build ? [] : ["next"];
    return (
        <PanelSection
            flush
            icon={IconCube}
            title="Models"
            description="Live first, then the most recently changed."
            actions={
                <Button asChild variant="ghost">
                    <Link href="/models">
                        All models
                        <IconArrowRight aria-hidden="true" />
                    </Link>
                </Button>
            }
        >
            <div className={FLUSH_GRID}>
                <DataGrid
                    columns={COLUMNS}
                    rows={rows}
                    getRowId={(model) => model.id}
                    rowLabel={(model) => model.name}
                    onOpen={(model) => router.history.push(hrefOf(model))}
                    hiddenColumns={hidden}
                    sortable={false}
                    loading={data.all.isLoading}
                    loadingRows={3}
                    empty={
                        data.all.error ? (
                            <SectionError error={data.all.error} retry={data.all.refetch} />
                        ) : (
                            "No models yet."
                        )
                    }
                />
            </div>
        </PanelSection>
    );
}
