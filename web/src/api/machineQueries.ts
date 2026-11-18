import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, succeed, unwrap } from "./client";
import { PROBLEMS_KEY } from "./problemQueries";

export type MachineAction = "drain" | "undrain" | "remove";

const METRICS_POLL_MS = 15000;

function request(action: MachineAction, pool: string, host: string): Promise<void> {
    const params = { params: { path: { pool, host } } };
    if (action === "remove") {
        return succeed(api.DELETE("/api/compute/pools/{pool}/machines/{host}", params));
    }
    if (action === "drain") {
        return succeed(api.POST("/api/compute/pools/{pool}/machines/{host}/drain", params));
    }
    return succeed(api.POST("/api/compute/pools/{pool}/machines/{host}/undrain", params));
}

export function useMachineAction(pool: string, host: string) {
    const client = useQueryClient();
    return useMutation({
        mutationFn: (action: MachineAction) => request(action, pool, host),
        onSettled: async () => {
            await client.invalidateQueries({ queryKey: ["compute", "pools"] });
            await client.invalidateQueries({ queryKey: PROBLEMS_KEY });
            await client.invalidateQueries({ queryKey: ["audit"] });
        },
    });
}

export function useMachineMetrics(pool: string, host: string, enabled: boolean) {
    return useQuery({
        queryKey: ["compute", "metrics", pool, host] as const,
        queryFn: () =>
            unwrap(
                api.GET("/api/compute/pools/{pool}/machines/{host}/metrics", {
                    params: { path: { pool, host } },
                }),
            ),
        enabled,
        refetchInterval: METRICS_POLL_MS,
    });
}

export type Workload = "serving" | "training";

export type PoolSettings = { description?: string; workloads?: Workload[] };

function putSettings(pool: string, body: PoolSettings) {
    return unwrap(
        api.PUT("/api/compute/pools/{pool}/settings", { params: { path: { pool } }, body }),
    );
}

function useSavePoolSettings<T>(pool: string, bodyOf: (value: T) => PoolSettings) {
    const client = useQueryClient();
    return useMutation({
        mutationFn: (value: T) => putSettings(pool, bodyOf(value)),
        onSettled: async () => {
            await client.invalidateQueries({ queryKey: ["compute", "pools"] });
            await client.invalidateQueries({ queryKey: ["audit"] });
        },
    });
}

export function usePoolSettings(pool: string) {
    return useSavePoolSettings(pool, (body: PoolSettings) => body);
}

export function usePoolWorkloads(pool: string) {
    return useSavePoolSettings(pool, (workloads: Workload[]) => ({ workloads }));
}
