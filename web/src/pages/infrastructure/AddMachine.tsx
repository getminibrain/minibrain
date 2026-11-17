import { IconLoader2, IconPlus } from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import {
    Button,
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    Link,
} from "obp-ui";
import { useEffect, useState } from "react";
import {
    type JoinRequestInfo,
    useApproveJoinRequest,
    useJoinRequests,
} from "~/api/joinRequestQueries";
import { type PoolTokenIssued, useIssueJoinToken, useJoinTokens } from "~/api/joinTokenQueries";
import { FormRows } from "~/components/FormRows";
import { ErrorLine } from "~/components/Section";
import { StatusText } from "~/components/models/StatusText";
import {
    IssuedCommand,
    type PoolChoice,
    PoolRows,
    RotateToken,
    choiceProblem,
    chosenPool,
    firstChoice,
    poolNames,
} from "./PoolJoin";
import { Command, JOIN_ENV, machineHref, workerCommand } from "./commands";
import type { PoolInfo } from "./parts";

const WATCH_MS = 3000;

type Target = { pool: string; nodes: Set<string>; requests: Set<number> };

function useWatchPools(on: boolean) {
    const client = useQueryClient();
    useEffect(() => {
        if (!on) {
            return;
        }
        const timer = window.setInterval(
            () => void client.invalidateQueries({ queryKey: ["compute", "pools"] }),
            WATCH_MS,
        );
        return () => window.clearInterval(timer);
    }, [client, on]);
}

function Asking({ request, pool }: { request: JoinRequestInfo; pool: string }) {
    const approve = useApproveJoinRequest();
    return (
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <StatusText tone="neutral" waiting>
                <span>
                    <span className="font-mono">{request.host}</span>
                    {" waits for approval · code "}
                    <span className="font-mono">{request.code}</span>
                </span>
            </StatusText>
            <Button
                type="button"
                variant="outline"
                disabled={approve.isPending}
                onClick={() => approve.mutate({ id: request.id, pool })}
            >
                {`Approve into ${pool}`}
            </Button>
            <ErrorLine error={approve.error} />
        </span>
    );
}

function Watch({ target, pools }: { target: Target; pools: PoolInfo[] }) {
    const requests = useJoinRequests();
    useWatchPools(true);
    const joined = pools
        .find((pool) => pool.name === target.pool)
        ?.nodes.find((node) => !target.nodes.has(node.id));
    if (joined) {
        return (
            <output className="inline-flex flex-wrap items-baseline gap-x-3">
                <StatusText tone="success">
                    <span>
                        <span className="font-mono">{joined.host}</span>
                        {` joined pool ${target.pool}`}
                    </span>
                </StatusText>
                <Link href={machineHref(joined)} className="text-primary hover:underline">
                    Open
                </Link>
            </output>
        );
    }
    const asking = (requests.data ?? []).find((request) => !target.requests.has(request.id));
    if (asking) {
        return <Asking request={asking} pool={target.pool} />;
    }
    return (
        <output className="inline-flex items-center gap-2 text-muted-foreground">
            <IconLoader2
                aria-hidden="true"
                className="size-4 animate-spin motion-reduce:animate-none"
            />
            Waiting for the machine…
        </output>
    );
}

function Commands({
    target,
    issued,
    prefix,
    onIssued,
}: {
    target: Target;
    issued: PoolTokenIssued | null;
    prefix: string | undefined;
    onIssued: (issued: PoolTokenIssued) => void;
}) {
    const origin = window.location.origin;
    const bare = workerCommand(target.pool, origin);
    if (issued) {
        return (
            <>
                <IssuedCommand issued={issued} origin={origin} />
                <div className="flex min-w-0 flex-col gap-label">
                    <span className="font-medium">Or run it without the token</span>
                    <span className="text-sm text-muted-foreground">
                        The machine prints a code and waits until an admin approves it.
                    </span>
                    <Command value={bare} label="Copy the command without the token" />
                </div>
            </>
        );
    }
    return (
        <div className="flex min-w-0 flex-col gap-label">
            <span className="font-medium">Run this on the machine</span>
            <span className="text-sm text-muted-foreground">
                {prefix
                    ? `With pool ${target.pool}'s join token (${prefix}…) in ${JOIN_ENV} it joins at once. Without it, the machine prints a code and waits until an admin approves it.`
                    : "The machine prints a code and waits until an admin approves it."}
            </span>
            <span className="flex min-w-0 flex-wrap items-center gap-2">
                <Command value={bare} label="Copy the command" />
                {prefix && <RotateToken pool={target.pool} exists onIssued={onIssued} />}
            </span>
        </div>
    );
}

function AddMachineDialog({
    pools,
    open,
    onOpenChange,
}: {
    pools: PoolInfo[];
    open: boolean;
    onOpenChange: (open: boolean) => void;
}) {
    const tokens = useJoinTokens({ enabled: open });
    const requests = useJoinRequests({ enabled: open });
    const names = poolNames(pools, tokens.data ?? []);
    const [picked, setPicked] = useState<PoolChoice | null>(null);
    const [touched, setTouched] = useState(false);
    const [target, setTarget] = useState<Target | null>(null);
    const [issued, setIssued] = useState<PoolTokenIssued | null>(null);
    const issue = useIssueJoinToken();
    const value = picked ?? firstChoice(names);
    const problem = choiceProblem(value, names);
    const prefix = target
        ? tokens.data?.find((token) => token.pool === target.pool)?.prefix
        : undefined;
    const close = (next: boolean) => {
        onOpenChange(next);
        if (!next) {
            issue.reset();
            setPicked(null);
            setTouched(false);
            setTarget(null);
            setIssued(null);
        }
    };
    const start = () => {
        setTouched(true);
        if (problem) {
            return;
        }
        const pool = chosenPool(value);
        const nodes = pools.find((item) => item.name === pool)?.nodes ?? [];
        setTarget({
            pool,
            nodes: new Set(nodes.map((node) => node.id)),
            requests: new Set((requests.data ?? []).map((request) => request.id)),
        });
        if (!tokens.data?.some((token) => token.pool === pool)) {
            issue.mutate(pool, { onSuccess: setIssued });
        }
    };
    return (
        <Dialog open={open} onOpenChange={close}>
            <DialogContent className="sm:max-w-3xl">
                <form
                    onSubmit={(event) => {
                        event.preventDefault();
                        start();
                    }}
                    noValidate
                    className="contents"
                >
                    <DialogHeader>
                        <DialogTitle>
                            {target ? `Add a machine to pool ${target.pool}` : "Add machine"}
                        </DialogTitle>
                        <DialogDescription>
                            {target
                                ? "minibrain must be installed on the machine. It shows up below once it joins."
                                : "Pick the pool the machine joins. Machines in a pool share placement and prices."}
                        </DialogDescription>
                    </DialogHeader>
                    {target ? (
                        <div className="flex min-w-0 flex-col gap-field">
                            {!issue.isPending && (
                                <Commands
                                    target={target}
                                    issued={issued}
                                    prefix={prefix}
                                    onIssued={setIssued}
                                />
                            )}
                            <Watch target={target} pools={pools} />
                        </div>
                    ) : (
                        <FormRows labels="narrow">
                            <PoolRows
                                id="join-pool"
                                names={names}
                                value={value}
                                onChange={setPicked}
                                touched={touched}
                            />
                        </FormRows>
                    )}
                    <ErrorLine error={issue.error} />
                    <DialogFooter>
                        {target ? (
                            <Button type="button" onClick={() => close(false)}>
                                Done
                            </Button>
                        ) : (
                            <>
                                <Button
                                    type="button"
                                    variant="outline"
                                    onClick={() => close(false)}
                                >
                                    Cancel
                                </Button>
                                <Button type="submit" disabled={touched && Boolean(problem)}>
                                    Continue
                                </Button>
                            </>
                        )}
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}

export function AddMachine({ pools }: { pools: PoolInfo[] }) {
    const [open, setOpen] = useState(false);
    return (
        <>
            <Button onClick={() => setOpen(true)}>
                <IconPlus aria-hidden="true" />
                Add machine
            </Button>
            <AddMachineDialog pools={pools} open={open} onOpenChange={setOpen} />
        </>
    );
}
