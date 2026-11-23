import type { ModelRow } from "~/api/client";
import { type ModelTab, modelPageHref } from "~/lib/modelLinks";

export type Step = {
    id: string;
    title: string;
    detail: string;
    action: string;
    href: string;
    done: boolean;
};

function newest(models: ModelRow[]): ModelRow | undefined {
    return [...models].sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0];
}

export function trained(model: ModelRow): boolean {
    return (model.versions ?? []).some(
        (version) => version.kind === "lora" && version.status === "ready",
    );
}

export function scored(model: ModelRow): boolean {
    return (model.versions ?? []).some(
        (version) =>
            version.kind === "lora" && version.score !== null && version.score !== undefined,
    );
}

export function deployedModel(model: ModelRow): boolean {
    return model.current_version !== null;
}

export function connected(model: ModelRow): boolean {
    return (model.key_count ?? 0) > 0;
}

export function stepsOf(models: ModelRow[], datasets: number): Step[] {
    const latest = newest(models);
    const modelHref = (tab: ModelTab) => (latest ? modelPageHref(latest.key, tab) : "/models/new");
    return [
        {
            id: "data",
            title: "Add data",
            detail: "Upload a CSV or JSONL, connect a database, or add the demo data.",
            action: "Add data",
            href: "/data?add=1",
            done: datasets > 0,
        },
        {
            id: "model",
            title: "Add a model",
            detail: "Pick a base model and a dataset. Version 0 is scored at once.",
            action: "Add model",
            href: "/models/new",
            done: models.length > 0,
        },
        {
            id: "train",
            title: "Train",
            detail: "Fine-tune a version on the dataset, scored on the same held-out rows.",
            action: "Train",
            href: latest ? `${modelPageHref(latest.key)}/train` : "/models/new",
            done: models.some(trained),
        },
        {
            id: "evaluate",
            title: "Evaluate",
            detail: "Compare the trained version with version 0 and see where it fails.",
            action: "Open Evaluation",
            href: modelHref("evaluation"),
            done: models.some(scored),
        },
        {
            id: "deploy",
            title: "Deploy",
            detail: "Make the version that meets the deploy rule live.",
            action: "Deploy",
            href: modelHref("overview"),
            done: models.some(deployedModel),
        },
        {
            id: "connect",
            title: "Connect an app",
            detail: "Create an API key; apps call /v1 with the model's API name.",
            action: "Create a key",
            href: modelHref("api"),
            done: models.some(connected),
        },
    ];
}
