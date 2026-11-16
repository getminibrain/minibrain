import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { api, unwrap } from "./client";

const LIVE_MS = 3000;

export function useJobMetrics(id: number, live: boolean, enabled = true) {
    return useQuery({
        queryKey: ["jobs", "metrics", id] as const,
        queryFn: () =>
            unwrap(api.GET("/api/jobs/{job_id}/metrics", { params: { path: { job_id: id } } })),
        refetchInterval: live ? LIVE_MS : false,
        enabled,
    });
}

export function useComparedRun(id: number, versus: number | null) {
    return useQuery({
        queryKey: ["jobs", "metrics", id, { versus }] as const,
        queryFn: () =>
            unwrap(
                api.GET("/api/jobs/{job_id}/metrics", {
                    params: { path: { job_id: id }, query: { versus: versus ?? undefined } },
                }),
            ),
        enabled: versus !== null,
        placeholderData: keepPreviousData,
        select: (metrics) => metrics.previous ?? null,
    });
}
