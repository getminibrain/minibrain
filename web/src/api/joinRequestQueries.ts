import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, unwrap } from "./client";
import type { components } from "./schema";

export type JoinRequestInfo = components["schemas"]["JoinRequestInfo"];

const JOIN_REQUESTS_KEY = ["compute", "join-requests"] as const;
const POLL_MS = 3000;

export function useJoinRequests({ enabled = true } = {}) {
    return useQuery({
        queryKey: JOIN_REQUESTS_KEY,
        queryFn: () => unwrap(api.GET("/api/compute/join-requests")),
        enabled,
        refetchInterval: POLL_MS,
    });
}

function useDecided() {
    const client = useQueryClient();
    return () =>
        Promise.all([
            client.invalidateQueries({ queryKey: JOIN_REQUESTS_KEY }),
            client.invalidateQueries({ queryKey: ["compute", "pools"] }),
        ]);
}

export function useApproveJoinRequest() {
    const decided = useDecided();
    return useMutation({
        mutationFn: ({ id, pool }: { id: number; pool: string }) =>
            unwrap(
                api.POST("/api/compute/join-requests/{request_id}/approve", {
                    params: { path: { request_id: id } },
                    body: { pool },
                }),
            ),
        onSuccess: decided,
    });
}

export function useDenyJoinRequest() {
    const decided = useDecided();
    return useMutation({
        mutationFn: (id: number) =>
            unwrap(
                api.POST("/api/compute/join-requests/{request_id}/deny", {
                    params: { path: { request_id: id } },
                }),
            ),
        onSuccess: decided,
    });
}
