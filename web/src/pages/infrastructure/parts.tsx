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
