import { useRouterState } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { type Crumb, PageCrumbs } from "~/components/PageCrumbs";
import { navEntryFor } from "~/components/navigation";

export type { Crumb };

export function PageHeader({
    title,
    caption,
    actions,
    icon,
    badge,
    crumbs,
}: {
    title: string;
    caption?: ReactNode;
    actions?: ReactNode;
    icon?: ReactNode;
    badge?: ReactNode;
    crumbs?: Crumb[];
}) {
    const pathname = useRouterState({ select: (state) => state.location.pathname });
    const Icon = icon === undefined ? navEntryFor(pathname)?.icon : undefined;
    const titleRow = (
        <div className="flex min-w-0 items-center gap-x-3">
            <h1 className="flex min-w-0 items-center gap-3 text-3xl font-normal">
                <span className="truncate" title={title}>
                    {title}
                </span>
            </h1>
            {badge && <div className="shrink-0">{badge}</div>}
        </div>
    );
    const captionLine = caption && <p className="text-base text-muted-foreground">{caption}</p>;
    const actionsBox = actions && (
        <div className="ml-auto flex min-h-8 shrink-0 items-center gap-2">{actions}</div>
    );
    return (
        <header className="flex flex-col gap-8 pb-3">
            <PageCrumbs items={crumbs ?? [{ label: title }]} />
            <div className="flex flex-wrap items-end justify-between gap-3">
                <div className="flex min-w-0 grow basis-48 items-center gap-4">
                    {icon ??
                        (Icon && (
                            <span
                                aria-hidden="true"
                                className="flex size-12 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground"
                            >
                                <Icon className="size-6" />
                            </span>
                        ))}
                    <div className="flex min-w-0 flex-1 flex-col gap-1">
                        {titleRow}
                        {captionLine}
                    </div>
                </div>
                {actionsBox}
            </div>
        </header>
    );
}
