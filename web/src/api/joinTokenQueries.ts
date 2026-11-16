import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, unwrap } from "./client";
import type { components } from "./schema";

type Schemas = components["schemas"];

export type JoinTokenInfo = Schemas["JoinTokenInfo"];
export type JoinTokenCreated = Schemas["JoinTokenCreated"];
export type JoinTokenCreate = Schemas["JoinTokenCreate"];
export type JoinRole = JoinTokenCreate["role"];

export const JOIN_TOKENS_KEY = ["compute", "join-tokens"] as const;
const WAITING_POLL_MS = 2000;

export function useJoinTokens({ enabled = true, waiting = false } = {}) {
    return useQuery({
        queryKey: JOIN_TOKENS_KEY,
        queryFn: () => unwrap(api.GET("/api/compute/join-tokens")),
        enabled,
        refetchInterval: waiting ? WAITING_POLL_MS : false,
    });
}

export function useCreateJoinToken() {
    const client = useQueryClient();
    return useMutation({
        mutationFn: (body: JoinTokenCreate) =>
            unwrap(api.POST("/api/compute/join-tokens", { body })),
        onSuccess: () => client.invalidateQueries({ queryKey: JOIN_TOKENS_KEY }),
    });
}

export function useRevokeJoinToken() {
    const client = useQueryClient();
    return useMutation({
        mutationFn: (token_id: number) =>
            unwrap(
                api.DELETE("/api/compute/join-tokens/{token_id}", {
                    params: { path: { token_id } },
                }),
            ),
        onSuccess: () => client.invalidateQueries({ queryKey: JOIN_TOKENS_KEY }),
    });
}
