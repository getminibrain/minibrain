import { useQuery } from "@tanstack/react-query";
import { api, unwrap } from "./client";
import type { components } from "./schema";

type Schemas = components["schemas"];

export type DatasetVersionInfo = Schemas["DatasetVersionInfo"];
export type DatasetVersionStats = Schemas["DatasetVersionStats"];
export type ChangeInfo = Schemas["ChangeInfo"];
export type DataSettings = Schemas["DataSettings"];
export type DatasetFolder = Schemas["DatasetFolderInfo"];

export const dataKeys = {
    folderRoots: ["data", "folders"] as const,
    datasetFolders: ["datasetFolders"] as const,
    datasetVersions: (slug: string) => ["datasets", slug, "versions"] as const,
    datasetVersionStats: (id: number) => ["dataset-versions", id, "stats"] as const,
    settings: ["settings", "data"] as const,
};

export function useFolderRoots() {
    return useQuery({
        queryKey: dataKeys.folderRoots,
        queryFn: () => unwrap(api.GET("/api/data/folders")),
    });
}

export function useDatasetFolders() {
    return useQuery({
        queryKey: dataKeys.datasetFolders,
        queryFn: () => unwrap(api.GET("/api/dataset-folders")),
    });
}

export function useDatasetVersions(slug: string, enabled = true) {
    return useQuery({
        queryKey: dataKeys.datasetVersions(slug),
        queryFn: () =>
            unwrap(api.GET("/api/datasets/{slug}/versions", { params: { path: { slug } } })),
        enabled: enabled && slug !== "",
    });
}

export function useDatasetVersionStats(id: number | null | undefined) {
    return useQuery({
        queryKey: dataKeys.datasetVersionStats(id ?? 0),
        queryFn: () =>
            unwrap(
                api.GET("/api/dataset-versions/{dataset_version_id}/stats", {
                    params: { path: { dataset_version_id: id ?? 0 } },
                }),
            ),
        enabled: typeof id === "number",
        staleTime: Number.POSITIVE_INFINITY,
        retry: false,
    });
}

export function useDataSettings() {
    return useQuery({
        queryKey: dataKeys.settings,
        queryFn: () => unwrap(api.GET("/api/settings/data")),
    });
}
