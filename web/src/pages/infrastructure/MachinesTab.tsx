import { type ReactNode, useState } from "react";
import { useJoinTokens } from "~/api/joinTokenQueries";
import { problemsOfMachine, useProblems } from "~/api/problemQueries";
import { useCan } from "~/lib/access";
import { useScrollToHash } from "~/lib/scrollToHash";
import { MachineSheet } from "./MachineSheet";
import { FlatLayout } from "./layouts/FlatLayout";
import { ListDetailLayout } from "./layouts/ListDetailLayout";
import { MemoryMapLayout } from "./layouts/MemoryMapLayout";
import { RefinedLayout } from "./layouts/RefinedLayout";
import type { MachinesView } from "./layouts/shared";
import { type LayoutKey, layoutOf, useMachinesSearch } from "./layouts/switcher";
import { machineRows } from "./machines";
import { type InfrastructureInfo, type PoolInfo, useOpenRows } from "./parts";
import { type Sort, nextSort } from "./sorting";

const LAYOUTS: Record<LayoutKey, (props: { view: MachinesView }) => ReactNode> = {
    A: RefinedLayout,
    B: FlatLayout,
    C: MemoryMapLayout,
    D: ListDetailLayout,
};

export function MachinesTab({
    pools,
    main,
    info,
    loading,
}: {
    pools: PoolInfo[];
    main: Record<string, string>;
    info: InfrastructureInfo | undefined;
    loading: boolean;
}) {
    const { search, update } = useMachinesSearch();
    const layout = layoutOf(search.layout);
    const open = useOpenRows();
    const can = useCan();
    const tokens = useJoinTokens({ enabled: can.admin });
    const problems = useProblems({ scope: "infrastructure" }).data;
    const [sort, setSort] = useState<Sort | null>(null);
    useScrollToHash(!loading);
    const all = machineRows(pools);
    const selected = all.find((row) => row.node.id === search.machine) ?? null;
    const view: MachinesView = {
        pools,
        all,
        problems,
        admin: can.admin,
        tokens: tokens.data,
        search,
        update,
        open,
        sort,
        onSort: (key) => setSort((current) => nextSort(current, key)),
        loading,
        selected,
        onOpen: (row) => update({ machine: row.node.id }),
        main,
        info,
    };
    const Layout = LAYOUTS[layout];
    return (
        <div className="flex flex-col gap-3">
            <Layout view={view} />
            {layout !== "D" && (
                <MachineSheet
                    row={selected}
                    main={main}
                    info={info}
                    problems={selected ? problemsOfMachine(problems, selected.node.id) : []}
                    onClose={() => update({ machine: "" })}
                />
            )}
        </div>
    );
}
