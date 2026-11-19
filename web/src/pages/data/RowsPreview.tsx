import { Button, RecordList, RecordListToggle, SegmentedTabs } from "obp-ui";
import { type ReactNode, useState } from "react";
import { ErrorLine, FLUSH_GRID } from "~/components/Section";
import { count } from "~/lib/format";

export type View = "records" | "table" | "example" | "quality";

const VIEWS: { key: View; label: string }[] = [
    { key: "records", label: "Records" },
    { key: "table", label: "Table" },
    { key: "example", label: "Example" },
    { key: "quality", label: "Quality" },
];

export function RowsPreview({
    records,
    total,
    loading,
    error,
    errorText,
    onRetry,
    table,
    example,
    marked,
    summary,
    empty,
    onMore,
    loadingMore = false,
    counting = false,
    strip,
    idle = false,
    quality,
    qualityBadge,
    view: shownView,
    onView,
    bar,
}: {
    records: unknown[];
    total: number | null | undefined;
    loading: boolean;
    error: unknown;
    errorText?: string;
    onRetry?: () => unknown;
    table: ReactNode;
    example?: ReactNode;
    marked?: string[];
    summary?: (record: unknown) => ReactNode;
    empty: string;
    onMore?: () => void;
    loadingMore?: boolean;
    counting?: boolean;
    strip?: ReactNode;
    idle?: boolean;
    quality?: ReactNode;
    qualityBadge?: number;
    view?: View;
    onView?: (view: View) => void;
    bar?: ReactNode;
}) {
    const [ownView, setOwnView] = useState<View>("records");
    const view = shownView ?? ownView;
    const setView = onView ?? setOwnView;
    const [open, setOpen] = useState<number[]>([0]);
    const views = VIEWS.filter(
        (item) =>
            (item.key !== "example" || example !== undefined) &&
            (item.key !== "quality" || quality !== undefined),
    ).map((item) =>
        item.key === "quality" && qualityBadge ? { ...item, badge: qualityBadge } : item,
    );
    const active =
        (view === "example" && !example) || (view === "quality" && !quality) ? "records" : view;
    const failed = Boolean(error) && records.length === 0;
    const rowsShown = active === "records" || active === "table";
    const whole = total === null || total === undefined || total <= records.length;
    const shown = `${count(records.length)} ${records.length === 1 ? "row" : "rows"}`;
    const status = idle
        ? "Not run"
        : loading
          ? "Loading…"
          : counting
            ? `${shown} shown · counting…`
            : whole
              ? shown
              : `First ${count(records.length)} of ${count(total)} rows`;
    return (
        <section aria-label="Preview" className="flex min-h-96 min-w-0 flex-1 flex-col">
            {strip && (
                <div className="flex h-10 shrink-0 items-center gap-x-4 overflow-hidden border-b px-3 text-sm whitespace-nowrap">
                    {strip}
                </div>
            )}
            <div className="flex h-12 shrink-0 items-center gap-3 border-b px-3">
                <SegmentedTabs
                    size="sm"
                    tabs={views}
                    active={active}
                    onSelect={(key) => setView(key as View)}
                />
                {active === "records" && (
                    <span className="ml-auto">
                        <RecordListToggle
                            total={records.length}
                            open={open}
                            onOpenChange={setOpen}
                        />
                    </span>
                )}
            </div>
            {bar && active !== "example" && (
                <div className="flex min-h-9 shrink-0 items-center gap-3 border-b bg-secondary px-3 text-sm">
                    {bar}
                </div>
            )}
            {Boolean(error) && active !== "quality" && (
                <div className="border-b px-3 py-2">
                    <ErrorLine error={error} message={errorText} onRetry={onRetry} />
                </div>
            )}
            {failed && rowsShown ? (
                <div className="min-h-0 flex-1" />
            ) : active === "table" ? (
                <div className={`flex min-h-0 flex-1 flex-col ${FLUSH_GRID}`}>{table}</div>
            ) : (
                <div className="min-h-0 flex-1 overflow-y-auto">
                    {active === "quality" ? (
                        quality
                    ) : active === "example" ? (
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
            {rowsShown && !failed && (
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
            )}
        </section>
    );
}
