import { SegmentedTabs } from "obp-ui";
import { useListSearch } from "~/lib/listSearch";

export const MACHINES_PATH = "/infrastructure/machines";

export const MACHINE_KEYS = [
    "layout",
    "group",
    "status",
    "pool",
    "role",
    "accelerator",
    "use",
    "q",
    "machine",
] as const;

export type MachineKey = (typeof MACHINE_KEYS)[number];

export type LayoutKey = "A" | "B" | "C" | "D";

const LAYOUTS: { key: LayoutKey; label: string; tip: string }[] = [
    {
        key: "A",
        label: "A",
        tip: "Refined: today's table, pool rows carry only totals that add something",
    },
    {
        key: "B",
        label: "B",
        tip: "Flat with filters: one machine per row, pool and status as columns",
    },
    {
        key: "C",
        label: "C",
        tip: "Memory map: what fills each machine's GPU memory, model by model",
    },
    {
        key: "D",
        label: "D",
        tip: "List and detail: pick a machine on the left, see all of it on the right",
    },
];

export function layoutOf(value: string | undefined): LayoutKey {
    return LAYOUTS.find((item) => item.key === value)?.key ?? "A";
}

export function useMachinesSearch() {
    return useListSearch(MACHINES_PATH, MACHINE_KEYS);
}

export function LayoutSwitch() {
    const { search, update } = useMachinesSearch();
    return (
        <span className="flex items-center gap-2">
            <span className="text-muted-foreground">Layout</span>
            <SegmentedTabs
                size="sm"
                tabs={LAYOUTS}
                active={layoutOf(search.layout)}
                onSelect={(key) => update({ layout: key === "A" ? "" : key, machine: "" })}
            />
        </span>
    );
}
