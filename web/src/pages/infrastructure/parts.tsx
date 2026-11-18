import { IconAlertTriangle, IconChevronRight } from "@tabler/icons-react";
import { Badge, Tooltip, TooltipContent, TooltipTrigger, cn } from "obp-ui";
import { type KeyboardEvent, type MouseEvent, useState } from "react";
import type { Problem } from "~/api/problemQueries";
import type { components } from "~/api/schema";
import { StatusText } from "~/components/models/StatusText";
import { count } from "~/lib/format";

export type PoolInfo = components["schemas"]["PoolInfo"];
export type NodeInfo = components["schemas"]["NodeInfo"];
export type ReplicaInfo = components["schemas"]["ReplicaInfo"];
export type StoreInfo = components["schemas"]["StoreInfo"];
export type InfrastructureInfo = components["schemas"]["InfrastructureInfo"];

export function plural(value: number, noun: string): string {
    return `${count(value)} ${noun}${value === 1 ? "" : "s"}`;
}

export function MachineName({ node, busy = false }: { node: NodeInfo; busy?: boolean }) {
    const draining = node.state === "draining";
    const tone = draining ? "warning" : node.online ? "success" : "neutral";
    return (
        <StatusText
            tone={tone}
            active={draining && busy && node.online}
            className="min-w-0 font-mono"
        >
            <span className="truncate">{node.host}</span>
        </StatusText>
    );
}

export function OnlineCount({ nodes }: { nodes: NodeInfo[] }) {
    const online = nodes.filter((node) => node.online).length;
    const tone = online === nodes.length ? "success" : online === 0 ? "neutral" : "warning";
    return (
        <StatusText tone={nodes.length === 0 ? "neutral" : tone} className="tabular-nums">
            {`${count(online)} of ${count(nodes.length)} online`}
        </StatusText>
    );
}

export function RowToggle({
    open,
    label,
    onToggle,
}: {
    open: boolean;
    label: string;
    onToggle: () => void;
}) {
    return (
        <button
            type="button"
            aria-expanded={open}
            aria-label={label}
            onClick={onToggle}
            className="flex size-6 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-secondary hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
            <IconChevronRight
                aria-hidden="true"
                className={cn(
                    "size-4 transition-transform duration-100 motion-reduce:transition-none",
                    open && "rotate-90",
                )}
            />
        </button>
    );
}

export function ProblemBadge({ problems }: { problems: Problem[] }) {
    if (problems.length === 0) {
        return null;
    }
    const label = problems.map((problem) => problem.text).join(", ");
    const tone = problems.some((problem) => problem.severity === "critical")
        ? "destructive"
        : "warning";
    return (
        <Tooltip>
            <TooltipTrigger asChild>
                <button type="button" aria-label={label} className="shrink-0 rounded-sm">
                    <Badge variant={tone} className="tabular-nums">
                        <IconAlertTriangle aria-hidden="true" />
                        {problems.length > 1 ? count(problems.length) : null}
                    </Badge>
                </button>
            </TooltipTrigger>
            <TooltipContent className="max-w-sm whitespace-normal">
                <ul className="flex flex-col gap-1">
                    {problems.map((problem) => (
                        <li key={problem.id}>{problem.text}</li>
                    ))}
                </ul>
            </TooltipContent>
        </Tooltip>
    );
}

const INTERACTIVE = "a, button, input, [role=link]";

export type OpenRows = {
    isOpen: (key: string, fallback: boolean) => boolean;
    set: (key: string, open: boolean) => void;
};

export function useOpenRows(): OpenRows {
    const [rows, setRows] = useState<Record<string, boolean>>({});
    return {
        isOpen: (key, fallback) => rows[key] ?? fallback,
        set: (key, open) => setRows((current) => ({ ...current, [key]: open })),
    };
}

export function rowEvents(onOpen: () => void, toggle?: (open: boolean) => void) {
    return {
        tabIndex: 0,
        onClick: (event: MouseEvent<HTMLTableRowElement>) => {
            if ((event.target as HTMLElement).closest(INTERACTIVE)) {
                return;
            }
            onOpen();
        },
        onKeyDown: (event: KeyboardEvent<HTMLTableRowElement>) => {
            if (event.target !== event.currentTarget) {
                return;
            }
            const action: Record<string, () => void> = {
                Enter: onOpen,
                ArrowRight: () => toggle?.(true),
                ArrowLeft: () => toggle?.(false),
            };
            const run = action[event.key];
            if (run) {
                event.preventDefault();
                run();
            }
        },
    };
}
