import type { SortingState } from "@tanstack/react-table";

export type SortOrder = "asc" | "desc";

export type ListSort<K extends string> = { sort: K; order: SortOrder };

export const SORT_KEYS = ["sort", "order"] as const;

type SortSearch = { sort?: string; order?: string };

export function sortFrom<K extends string>(
    keys: readonly K[],
    fallback: ListSort<K>,
    search: SortSearch,
): ListSort<K> {
    const sort = keys.find((key) => key === search.sort);
    if (!sort) {
        return fallback;
    }
    return { sort, order: search.order === "asc" ? "asc" : "desc" };
}

export function isDefaultSort<K extends string>(sort: ListSort<K>, fallback: ListSort<K>): boolean {
    return sort.sort === fallback.sort && sort.order === fallback.order;
}

export function sortingOf<K extends string>(sort: ListSort<K>): SortingState {
    return [{ id: sort.sort, desc: sort.order === "desc" }];
}

export function sortSearch<K extends string>(
    next: SortingState,
    fallback: ListSort<K>,
): { sort: string; order: string } {
    const first = next[0];
    const chosen = first ? { sort: first.id, order: first.desc ? "desc" : "asc" } : fallback;
    return chosen.sort === fallback.sort && chosen.order === fallback.order
        ? { sort: "", order: "" }
        : chosen;
}
