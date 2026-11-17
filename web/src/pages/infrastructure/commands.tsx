import { CopyButton } from "~/components/CopyButton";
import { PoolLink } from "~/components/PoolLink";
import type { NodeInfo } from "./parts";

export const JOIN_ENV = "MINIBRAIN_JOIN_TOKEN";

export function Command({ value, label }: { value: string; label: string }) {
    return (
        <span className="flex max-w-full min-w-0 items-center gap-1 rounded-md border bg-muted pl-3">
            <code className="min-w-0 overflow-x-auto py-1 font-mono text-sm whitespace-nowrap">
                {value}
            </code>
            <CopyButton value={value} label={label} />
        </span>
    );
}

export function machineHref(node: NodeInfo): string {
    return `/infrastructure/machines?machine=${encodeURIComponent(node.id)}`;
}

export function workerCommand(pool: string, origin: string): string {
    return `minibrain worker --main ${origin} --pool ${pool}`;
}

export function tokenCommand(secret: string, pool: string, origin: string): string {
    return `${JOIN_ENV}=${secret} ${workerCommand(pool, origin)}`;
}

function engineCommand(origin: string): string {
    return `minibrain engine --model <model> --main-url ${origin} --host 0.0.0.0`;
}

export function restartCommand(node: NodeInfo, pool: string, origin: string): string {
    const worker = node.roles.includes("worker");
    if (node.joined === "local") {
        return worker ? `minibrain worker --main ${origin}` : engineCommand(origin);
    }
    if (node.joined === "approval" && worker) {
        return `minibrain worker --main ${origin}`;
    }
    const command = worker
        ? workerCommand(pool, origin)
        : `${engineCommand(origin)} --pool ${pool}`;
    return `${JOIN_ENV}=… ${command}`;
}

function RestartHint({ node, pool }: { node: NodeInfo; pool: string }) {
    if (node.joined === "local") {
        return <span>{`Run this on ${node.host}; it joins with main's local worker token.`}</span>;
    }
    if (node.joined === "approval" && node.roles.includes("worker")) {
        return <span>{`Run this on ${node.host}; it keeps the approval it already has.`}</span>;
    }
    return (
        <span>
            {`Run this on ${node.host}, with … replaced by the join token of pool `}
            <PoolLink name={pool} />
            {". Rotate the token on the pool's row if it is lost."}
        </span>
    );
}

export function RestartFix({ node, pool }: { node: NodeInfo; pool: string }) {
    return (
        <>
            <RestartHint node={node} pool={pool} />
            <Command
                value={restartCommand(node, pool, window.location.origin)}
                label={`Copy the command that restarts ${node.host}`}
            />
        </>
    );
}
