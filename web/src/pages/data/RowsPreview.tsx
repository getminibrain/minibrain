import { Button, RecordList, RecordListToggle, SegmentedTabs } from "obp-ui";
import { type ReactNode, useState } from "react";
import { ErrorLine, FLUSH_GRID } from "~/components/Section";
import { count } from "~/lib/format";

type View = "records" | "table" | "example";

const VIEWS: { key: View; label: string }[] = [
    { key: "records", label: "Records" },
    { key: "table", label: "Table" },
    { key: "example", label: "Example" },
];

export function RowsPreview({
    records,
    total,
    loading,
    error,
    onRetry,
    table,
    example,
    marked,
    summary,
    empty,
    onMore,
    loadingMore = false,
}: {
    records: unknown[];
    total: number | null | undefined;
    loading: boolean;
    error: unknown;
    onRetry?: () => unknown;
    table: ReactNode;
    example?: ReactNode;
    marked?: string[];
    summary?: (record: unknown) => ReactNode;
    empty: string;
    onMore?: () => void;
    loadingMore?: boolean;
}) {
    const [view, setView] = useState<View>("records");
    const [open, setOpen] = useState<number[]>([0]);
    const views = VIEWS.filter((item) => item.key !== "example" || example !== undefined);
    const shown = view === "example" && !example ? "records" : view;
    const whole = total === null || total === undefined || total <= records.length;
    const status = loading
        ? "Loading…"
        : whole
          ? `${count(records.length)} ${records.length === 1 ? "row" : "rows"}`
          : `First ${count(records.length)} of ${count(total)} rows`;
    return (
        <section aria-label="Preview" className="flex min-h-96 min-w-0 flex-1 flex-col">
            <div className="flex h-12 shrink-0 items-center gap-3 border-b px-3">
                <SegmentedTabs
                    size="sm"
                    tabs={views}
                    active={shown}
                    onSelect={(key) => setView(key as View)}
                />
                {shown === "records" && (
                    <span className="ml-auto">
                        <RecordListToggle
                            total={records.length}
                            open={open}
                            onOpenChange={setOpen}
                        />
                    </span>
                )}
            </div>
            {Boolean(error) && (
                <div className="border-b px-3 py-2">
                    <ErrorLine error={error} onRetry={onRetry} />
                </div>
            )}
            {shown === "table" ? (
                <div className={`flex min-h-0 flex-1 flex-col ${FLUSH_GRID}`}>{table}</div>
            ) : (
                <div className="min-h-0 flex-1 overflow-y-auto">
                    {shown === "example" ? (
                        example
                    ) : loading ? (
                        <p className="px-3 py-2 text-muted-foreground">Loading rows…</p>
                    ) : (
                        <RecordList
                            records={records}
                            open={open}
                            onOpenChange={setOpen}
                            marked={marked}
                            summary={summary}
                            empty={empty}
                        />
                    )}
                </div>
            )}
            <div className="flex h-9 shrink-0 items-center gap-3 border-t px-3 text-sm text-muted-foreground tabular-nums">
                <span className="truncate">{status}</span>
                {onMore && !loading && !whole && (
                    <Button
                        variant="link"
                        size="sm"
                        className="h-auto px-0"
                        disabled={loadingMore}
                        onClick={onMore}
                    >
                        {loadingMore ? "Loading…" : "Show more"}
                    </Button>
                )}
            </div>
        </section>
    );
}
