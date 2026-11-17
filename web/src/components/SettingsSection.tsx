import type { TablerIcon } from "@tabler/icons-react";
import { Card, cn } from "obp-ui";
import type { ReactNode } from "react";
import { FLUSH_GRID } from "~/components/Section";

const TWO_COLUMNS =
    "@min-[56rem]/settings:grid-cols-[18rem_minmax(0,1fr)] @min-[56rem]/settings:gap-x-10";

const FLASH =
    "relative isolate before:pointer-events-none before:absolute before:-inset-x-2.5 before:-inset-y-1 before:-z-10 before:rounded-md before:bg-highlight before:opacity-0 before:transition-opacity before:duration-150 group-data-flash/panel:before:opacity-100 motion-reduce:before:transition-none";

export function SettingsSection({
    icon: Icon,
    anchor,
    title,
    description,
    actions,
    flush = false,
    children,
}: {
    icon: TablerIcon;
    anchor?: string;
    title: string;
    description?: ReactNode;
    actions?: ReactNode;
    flush?: boolean;
    children: ReactNode;
}) {
    return (
        <section
            id={anchor}
            className={cn("group/panel grid scroll-my-24 grid-cols-1 gap-4", TWO_COLUMNS)}
        >
            <header className={cn("flex min-w-0 flex-col gap-1 self-start", FLASH)}>
                <h2 className="flex items-center gap-2 text-lg font-semibold">
                    <Icon aria-hidden="true" className="size-5 shrink-0 text-muted-foreground" />
                    {title}
                </h2>
                {description && (
                    <div className="pl-7 text-sm text-muted-foreground">{description}</div>
                )}
            </header>
            <Card className="min-w-0 gap-0 self-start overflow-clip py-0">
                <div className={flush ? FLUSH_GRID : "p-panel"}>{children}</div>
                {actions && (
                    <footer className="flex flex-wrap items-center justify-end gap-2 border-t px-panel py-3">
                        {actions}
                    </footer>
                )}
            </Card>
        </section>
    );
}

export function SettingsSections({ children }: { children: ReactNode }) {
    return <div className="@container/settings flex flex-col gap-10 pt-4">{children}</div>;
}
