import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, unwrap } from "./client";
import type { components } from "./schema";

type Schemas = components["schemas"];

export type PoolToken = Schemas["PoolToken"];
export type PoolTokenIssued = Schemas["PoolTokenIssued"];

export const JOIN_TOKENS_KEY = ["compute", "join-tokens"] as const;

export function useJoinTokens({ enabled = true } = {}) {
    return useQuery({
        queryKey: JOIN_TOKENS_KEY,
        queryFn: () => unwrap(api.GET("/api/compute/join-tokens")),
        enabled,
    });
}

export function useIssueJoinToken() {
    const client = useQueryClient();
    return useMutation({
        mutationFn: (pool: string) =>
            unwrap(api.POST("/api/compute/join-tokens", { body: { pool } })),
        onSuccess: () => client.invalidateQueries({ queryKey: JOIN_TOKENS_KEY }),
    });
}
