import { IconStack2 } from "@tabler/icons-react";
import type { ColumnDef } from "@tanstack/react-table";
import { DataGrid } from "obp-ui";
import { CopyButton } from "~/components/CopyButton";
import { MiddleTruncate } from "~/components/MiddleTruncate";
import { PanelSection } from "~/components/Section";
import { bytes } from "~/lib/time";
import type { InfrastructureInfo, StoreInfo } from "./parts";

const STORE_KIND: Record<StoreInfo["kind"], string> = {
    sqlite: "SQLite file",
    postgres: "Postgres",
    folder: "Folder",
    s3: "S3 bucket",
};

function inHome(location: string, home: string): string {
    if (!home || !location.startsWith(`${home}/`)) {
        return location;
    }
    const name = home.split("/").filter(Boolean).pop() ?? home;
    return `${name}${location.slice(home.length)}`;
}

function storeColumns(home: string): ColumnDef<StoreInfo, unknown>[] {
    return [
        { header: "Holds", accessorKey: "name" },
        {
            header: "Kind",
            id: "kind",
            accessorFn: (store) => STORE_KIND[store.kind],
            cell: ({ row }) => STORE_KIND[row.original.kind],
        },
        {
            header: "Where",
            id: "location",
            accessorFn: (store) => inHome(store.location, home).toLowerCase(),
            cell: ({ row }) => (
                <span className="flex min-w-0 items-center gap-1">
                    <MiddleTruncate
                        text={inHome(row.original.location, home)}
                        className="max-w-72"
                    />
                    <CopyButton
                        value={row.original.location}
                        label={`Copy the full path of ${row.original.name}`}
                    />
                </span>
            ),
        },
        {
            header: "Used",
            id: "used",
            accessorFn: (store) => store.used_bytes ?? undefined,
            sortUndefined: "last",
            cell: ({ row }) => (
                <span className="tabular-nums">{bytes(row.original.used_bytes)}</span>
            ),
        },
    ];
}

export function StoresSection({ info }: { info: InfrastructureInfo | undefined }) {
    const home = info?.home ?? "";
    return (
        <PanelSection
            bare
            icon={IconStack2}
            title="Stores"
            description="Where each kind of file and record lives."
        >
            <div className="flex flex-col gap-3">
                <DataGrid columns={storeColumns(home)} rows={info?.stores ?? []} />
                <p className="flex min-w-0 items-baseline gap-1 text-sm text-muted-foreground">
                    <span className="shrink-0">Everything lives under</span>
                    <MiddleTruncate text={home || "…"} className="text-foreground" />
                    <span className="shrink-0">
                        {"· set "}
                        <span className="font-mono text-foreground">MINIBRAIN_HOME</span>
                        {" to move it"}
                    </span>
                </p>
            </div>
        </PanelSection>
    );
}
