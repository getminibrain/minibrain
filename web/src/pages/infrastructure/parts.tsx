import { Tooltip, TooltipContent, TooltipTrigger, cn } from "obp-ui";
import type { components } from "~/api/schema";
import { StatusText } from "~/components/models/StatusText";
import { count } from "~/lib/format";
import { bytes } from "~/lib/time";

export type PoolInfo = components["schemas"]["PoolInfo"];
export type NodeInfo = components["schemas"]["NodeInfo"];
export type ReplicaInfo = components["schemas"]["ReplicaInfo"];
export type StoreInfo = components["schemas"]["StoreInfo"];
export type InfrastructureInfo = components["schemas"]["InfrastructureInfo"];

export const SERIES = [
    "bg-(--chart-series-1)",
    "bg-(--chart-series-2)",
    "bg-(--chart-series-3)",
    "bg-(--chart-series-4)",
] as const;

export const OTHER = "bg-faint";

export const FREE = "border bg-secondary";

export type Segment = { key: string; label: string; value: number; fill: string };

export function plural(value: number, noun: string): string {
    return `${count(value)} ${noun}${value === 1 ? "" : "s"}`;
}

export function fleetAnchor(pool: string): string {
    return `fleet-${pool}`;
}

export function MachineName({ node }: { node: NodeInfo }) {
    return (
        <StatusText tone={node.online ? "success" : "neutral"} className="min-w-0 font-mono">
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

function share(value: number, total: number): string {
    return `${Math.round((value / total) * 100)}%`;
}

export function SegmentedBar({
    segments,
    total,
    label,
}: {
    segments: Segment[];
    total: number;
    label: string;
}) {
    const shown = segments.filter((segment) => segment.value > 0);
    const described = shown.map((segment) => `${segment.label} ${bytes(segment.value)}`).join(", ");
    return (
        <div
            role="img"
            aria-label={`${label}: ${described || "nothing"} of ${bytes(total)}`}
            className="flex h-2 w-full gap-0.5 overflow-hidden rounded-md"
        >
            {shown.map((segment) => (
                <Tooltip key={segment.key}>
                    <TooltipTrigger asChild>
                        <span
                            className={cn("block h-full min-w-0.5 shrink-0", segment.fill)}
                            style={{ width: `${Math.min(100, (segment.value / total) * 100)}%` }}
                        />
                    </TooltipTrigger>
                    <TooltipContent>
                        <span className="tabular-nums">
                            {`${segment.label} · ${bytes(segment.value)} · ${share(segment.value, total)}`}
                        </span>
                    </TooltipContent>
                </Tooltip>
            ))}
            <span className="block h-full min-w-0 flex-1 bg-secondary" />
        </div>
    );
}

export function Swatch({ fill }: { fill: string }) {
    return <span aria-hidden className={cn("size-2 shrink-0 rounded-md", fill)} />;
}

export function Legend({ items }: { items: { label: string; fill: string; value?: string }[] }) {
    return (
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
            {items.map((item) => (
                <li key={item.label} className="inline-flex items-center gap-1.5">
                    <Swatch fill={item.fill} />
                    <span>{item.label}</span>
                    {item.value && (
                        <span className="text-foreground tabular-nums">{item.value}</span>
                    )}
                </li>
            ))}
        </ul>
    );
}
