import { useQuery } from "@tanstack/react-query";
import { api, unwrap } from "./client";
import type { components } from "./schema";

export type Problem = components["schemas"]["Problem"];
export type ProblemKind = Problem["kind"];
export type ProblemSeverity = Problem["severity"];
export type ProblemView = "infrastructure" | "model";
export type ProblemFilter = { scope?: ProblemView; model?: string };

export const PROBLEMS_KEY = ["problems"] as const;
const POLL_MS = 15000;

export function useProblems(filter: ProblemFilter = {}) {
    return useQuery({
        queryKey: [...PROBLEMS_KEY, filter.scope ?? "all", filter.model ?? ""] as const,
        queryFn: () => unwrap(api.GET("/api/problems", { params: { query: filter } })),
        refetchInterval: POLL_MS,
    });
}

export function problemsOfMachine(problems: Problem[] | undefined, machine: string): Problem[] {
    return (problems ?? []).filter((problem) => problem.machine === machine);
}

export type HealthChecks = components["schemas"]["Checks"];
export type AreaCheck = components["schemas"]["AreaCheck"];
export type Area = AreaCheck["area"];

export function useHealthChecks() {
    return useQuery({
        queryKey: [...PROBLEMS_KEY, "checks"] as const,
        queryFn: () => unwrap(api.GET("/api/problems/checks")),
        refetchInterval: POLL_MS,
    });
}
