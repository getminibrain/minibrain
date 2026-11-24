import { IconArrowRight, IconCheck, IconRoute } from "@tabler/icons-react";
import { Button, Link, cn } from "obp-ui";
import type { ModelRow } from "~/api/client";
import { useDatasets } from "~/api/queries";
import { PanelSection } from "~/components/Section";
import { useCan } from "~/lib/access";
import { count } from "~/lib/format";
import type { HomeData } from "./data";
import { type Step, connected, deployedModel, scored, stepsOf, trained } from "./steps";

type Stage = Step & { value: string; unit: string; link: string };

function Progress({ stages }: { stages: Stage[] }) {
    return (
        <span aria-hidden="true" className="flex w-24 gap-0.5">
            {stages.map((stage) => (
                <span
                    key={stage.id}
                    className={cn(
                        "h-1.5 flex-1 rounded-sm",
                        stage.done ? "bg-success" : "bg-muted",
                    )}
                />
            ))}
        </span>
    );
}

function columnsOf(stages: Stage[], next: Stage | undefined): string {
    return stages
        .map((stage) => (stage === next ? "minmax(max-content, 1fr)" : "minmax(0, 1fr)"))
        .join(" ");
}

function many(value: number, one: string, other: string): string {
    return value === 1 ? one : other;
}

function stagesOf(models: ModelRow[], datasets: number | undefined, requests: number): Stage[] {
    const steps = stepsOf(models, datasets ?? 0);
    const step = (id: string) => steps.find((item) => item.id === id) as Step;
    const keys = models.reduce((sum, model) => sum + (model.key_count ?? 0), 0);
    const trainedCount = models.filter(trained).length;
    const scoredCount = models.filter(scored).length;
    const live = models.filter(deployedModel).length;
    return [
        {
            ...step("data"),
            title: "Data",
            value: count(datasets),
            unit: many(datasets ?? 0, "dataset", "datasets"),
            link: "/data",
        },
        {
            ...step("model"),
            title: "Models",
            value: count(models.length),
            unit: many(models.length, "custom model", "custom models"),
            link: "/models",
        },
        {
            ...step("train"),
            title: "Trained",
            value: count(trainedCount),
            unit: `of ${count(models.length)} trained`,
            link: "/training",
        },
        {
            ...step("evaluate"),
            title: "Evaluated",
            value: count(scoredCount),
            unit: `of ${count(models.length)} scored`,
            link: "/evaluations",
        },
        {
            ...step("deploy"),
            title: "Live",
            value: count(live),
            unit: many(live, "model serving", "models serving"),
            link: "/models",
        },
        {
            ...step("connect"),
            title: "Connected",
            value: count(keys),
            unit: many(keys, "API key", "API keys"),
            link: "/api-keys",
        },
        {
            id: "run",
            title: "Requests",
            detail: "Apps call /v1 with the model's API name.",
            action: "Open Monitoring",
            href: "/monitor?range=7d",
            done: requests > 0 && models.some(connected),
            value: count(requests),
            unit: "in the last 7 days",
            link: "/monitor?range=7d",
        },
    ];
}

type Band = "done" | "next" | "todo";

const BANDS: Record<Band, string> = {
    done: "bg-success/10 text-success",
    next: "bg-primary/10 text-primary",
    todo: "text-muted-foreground",
};

function bandOf(stage: Stage, next: boolean): Band {
    if (stage.done) {
        return "done";
    }
    return next ? "next" : "todo";
}

function StageTitle({ stage, band }: { stage: Stage; band: Band }) {
    return (
        <span
            className={cn(
                "-mx-4 -mt-3 mb-2 flex items-center gap-2 px-4 py-2 text-sm",
                BANDS[band],
            )}
        >
            {band === "done" && (
                <IconCheck aria-hidden="true" className="size-4 shrink-0" strokeWidth={3} />
            )}
            {band === "next" && (
                <IconArrowRight aria-hidden="true" className="size-4 shrink-0" strokeWidth={2.5} />
            )}
            <span className="truncate">{stage.title}</span>
            <span className="sr-only">{stage.done ? ", done" : ", not done"}</span>
        </span>
    );
}

function StageCell({ stage, next, actions }: { stage: Stage; next: boolean; actions: boolean }) {
    return (
        <li className="flex min-w-0 flex-col justify-between gap-3 px-4 py-3">
            <div className="flex min-w-0 flex-col gap-0.5">
                <StageTitle stage={stage} band={bandOf(stage, next)} />
                <Link
                    href={stage.link}
                    className="w-fit text-2xl font-semibold text-foreground tabular-nums hover:underline"
                >
                    {stage.value}
                </Link>
                <span className="truncate text-sm text-muted-foreground tabular-nums">
                    {stage.unit}
                </span>
            </div>
            {next && actions && (
                <Button asChild className="w-fit">
                    <Link href={stage.href}>
                        {stage.action}
                        <IconArrowRight aria-hidden="true" />
                    </Link>
                </Button>
            )}
        </li>
    );
}

export function JourneyStrip({ data }: { data: HomeData }) {
    const can = useCan();
    const datasets = useDatasets(can.build);
    const models = data.custom.data ?? [];
    const stages = stagesOf(models, datasets.data?.length, data.usage?.total ?? 0).filter(
        (stage) => can.build || stage.id !== "data",
    );
    const next = stages.find((stage) => !stage.done);
    const done = stages.filter((stage) => stage.done).length;
    return (
        <PanelSection
            bare
            icon={IconRoute}
            title="From data to an app"
            description={
                <span className="flex items-center gap-3">
                    <Progress stages={stages} />
                    {done === stages.length
                        ? "Every step has run. Improve with feedback and new data."
                        : `${done} of ${stages.length} steps have run on this install.`}
                </span>
            }
        >
            <ol
                className="grid divide-x overflow-clip rounded-lg border bg-card"
                style={{ gridTemplateColumns: columnsOf(stages, can.build ? next : undefined) }}
            >
                {stages.map((stage) => (
                    <StageCell
                        key={stage.id}
                        stage={stage}
                        next={stage === next}
                        actions={can.build}
                    />
                ))}
            </ol>
        </PanelSection>
    );
}
