import { useAllModels, useModels, useRecentJobs } from "~/api/queries";
import {
    type ListModel,
    combinedUsage,
    deployed,
    listModels,
    updatedAt,
} from "~/pages/models/list/model";

export const SHOWN_MODELS = 8;

function rank(model: ListModel): number {
    return deployed(model) ? 0 : model.kind === "custom" ? 1 : 2;
}

function shownModels(models: ListModel[]): ListModel[] {
    return models
        .filter((model) => model.kind === "custom" || deployed(model))
        .sort(
            (left, right) =>
                rank(left) - rank(right) || updatedAt(right).localeCompare(updatedAt(left)),
        );
}

export function useHomeData() {
    const custom = useModels();
    const all = useAllModels();
    const jobs = useRecentJobs(6);
    return {
        custom,
        all,
        jobs,
        shown: all.data ? shownModels(listModels(all.data)) : [],
        usage: all.data ? combinedUsage(all.data.map((row) => row.usage)) : undefined,
    };
}

export type HomeData = ReturnType<typeof useHomeData>;
