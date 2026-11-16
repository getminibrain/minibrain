import { Tooltip, TooltipContent, TooltipTrigger } from "obp-ui";
import type { components } from "~/api/schema";
import { StatusText } from "~/components/models/StatusText";
import { count } from "~/lib/format";

export type PoolInfo = components["schemas"]["PoolInfo"];
export type NodeInfo = components["schemas"]["NodeInfo"];
export type ReplicaInfo = components["schemas"]["ReplicaInfo"];
export type StoreInfo = components["schemas"]["StoreInfo"];
export type InfrastructureInfo = components["schemas"]["InfrastructureInfo"];
export type PoolRoom = components["schemas"]["PoolRoom"];

export function plural(value: number, noun: string): string {
    return `${count(value)} ${noun}${value === 1 ? "" : "s"}`;
}

export function fleetAnchor(pool: string): string {
    return `fleet-${pool}`;
}

export function roomText(room: PoolRoom): string {
    const serve =
        room.serve_size && room.serve_count > 0
            ? `Room for ${count(room.serve_count)} more ${room.serve_size} model${room.serve_count === 1 ? "" : "s"}`
            : "No room for another model";
    const train =
        room.train_size && room.train_strategy
            ? `trains up to ${room.train_size} (${room.train_strategy})`
            : "too full to train";
    return `${serve} · ${train}`;
}

export function RoomLine({ room }: { room: PoolRoom | null | undefined }) {
    if (!room) {
        return null;
    }
    return (
        <Tooltip>
            <TooltipTrigger asChild>
                <span className="min-w-0 cursor-default text-sm text-muted-foreground tabular-nums">
                    {roomText(room)}
                </span>
            </TooltipTrigger>
            <TooltipContent className="max-w-sm whitespace-normal">{room.basis}</TooltipContent>
        </Tooltip>
    );
}

export function MachineName({ node }: { node: NodeInfo }) {
    const tone = node.state === "draining" ? "warning" : node.online ? "success" : "neutral";
    return (
        <StatusText tone={tone} className="min-w-0 font-mono">
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
