import { IconCopy, IconDots, IconKey, IconRefresh } from "@tabler/icons-react";
import {
    Button,
    ConfirmDialog,
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuRadioGroup,
    DropdownMenuRadioItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
    useToast,
} from "obp-ui";
import { useState } from "react";
import { type PoolToken, type PoolTokenIssued, useIssueJoinToken } from "~/api/joinTokenQueries";
import { type Workload, usePoolWorkloads } from "~/api/machineQueries";
import { ErrorLine } from "~/components/Section";
import { LOCAL_POOL, RotatedDialog } from "../PoolJoin";
import { useOf } from "../PoolUse";
import { workerCommand } from "../commands";
import type { PoolInfo } from "../parts";

type UseKey = ReturnType<typeof useOf>;

const USES: { key: UseKey; label: string; hint: string; workloads: Workload[] }[] = [
    { key: "any", label: "Any", hint: "Serving and training", workloads: ["serving", "training"] },
    { key: "serving", label: "Serving", hint: "Deployed models", workloads: ["serving"] },
    { key: "training", label: "Training", hint: "Training and scoring", workloads: ["training"] },
];

function effectOf(pool: string, use: UseKey): string {
    if (use === "serving") {
        return `Only deployed models run on pool ${pool}: training and scoring jobs no longer start there. Jobs running there now finish.`;
    }
    if (use === "training") {
        return `Only training and scoring jobs run on pool ${pool}: new deployments no longer go there. Models already deployed keep serving until moved.`;
    }
    return `New deployments and training and scoring jobs can all go to pool ${pool}.`;
}

function useCopy(pool: string) {
    const toast = useToast();
    return () => {
        const command = workerCommand(pool, window.location.origin);
        const blocked = () => toast({ title: "This browser blocks copying here", tone: "warning" });
        if (!navigator.clipboard) {
            blocked();
            return;
        }
        navigator.clipboard
            .writeText(command)
            .then(
                () =>
                    toast({ title: "Join command copied", description: command, tone: "success" }),
                blocked,
            );
    };
}

export function PoolRowMenu({ pool, token }: { pool: PoolInfo; token: PoolToken | undefined }) {
    const issue = useIssueJoinToken();
    const save = usePoolWorkloads(pool.name);
    const copy = useCopy(pool.name);
    const current = useOf(pool.workloads);
    const [rotating, setRotating] = useState(false);
    const [asked, setAsked] = useState<UseKey | null>(null);
    const [issued, setIssued] = useState<PoolTokenIssued | null>(null);
    const target = USES.find((item) => item.key === asked);
    const joins = pool.name !== LOCAL_POOL;
    const run = () =>
        issue
            .mutateAsync(pool.name)
            .then((next) => {
                setRotating(false);
                setIssued(next);
            })
            .catch(() => undefined);
    return (
        <>
            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <Button
                        variant="ghost"
                        size="icon-xs"
                        aria-label={`Actions for pool ${pool.name}`}
                    >
                        <IconDots />
                    </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-72">
                    {joins && (
                        <>
                            <DropdownMenuLabel className="flex items-baseline justify-between gap-3">
                                <span>Join token</span>
                                <span className="font-mono font-normal text-muted-foreground">
                                    {token ? `${token.prefix}…` : "None"}
                                </span>
                            </DropdownMenuLabel>
                            <DropdownMenuItem onSelect={copy}>
                                <IconCopy aria-hidden="true" />
                                Copy join command
                            </DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => (token ? setRotating(true) : run())}>
                                {token ? (
                                    <IconRefresh aria-hidden="true" />
                                ) : (
                                    <IconKey aria-hidden="true" />
                                )}
                                {token ? "Rotate join token" : "Make join token"}
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                        </>
                    )}
                    <DropdownMenuLabel>Used for</DropdownMenuLabel>
                    <DropdownMenuRadioGroup
                        value={current}
                        onValueChange={(value) => {
                            if (value !== current) {
                                setAsked(value as UseKey);
                            }
                        }}
                    >
                        {USES.map((item) => (
                            <DropdownMenuRadioItem key={item.key} value={item.key}>
                                <span>{item.label}</span>
                                <span className="ml-auto text-sm text-muted-foreground">
                                    {item.hint}
                                </span>
                            </DropdownMenuRadioItem>
                        ))}
                    </DropdownMenuRadioGroup>
                </DropdownMenuContent>
            </DropdownMenu>
            <ConfirmDialog
                open={rotating}
                onOpenChange={setRotating}
                title={`Rotate pool ${pool.name}'s join token?`}
                description="A new token replaces it. Machines and engines that joined with the old token are cut off at once and need the new one. Machines you approved stay."
                confirmLabel="Rotate"
                destructive
                onConfirm={run}
            />
            {target && (
                <ConfirmDialog
                    open
                    onOpenChange={(open) => !open && setAsked(null)}
                    title={`Use pool ${pool.name} for ${target.key === "any" ? "anything" : target.label.toLowerCase()}?`}
                    description={effectOf(pool.name, target.key)}
                    confirmLabel={
                        target.key === "any"
                            ? "Use for anything"
                            : `Use for ${target.label.toLowerCase()}`
                    }
                    onConfirm={() =>
                        save
                            .mutateAsync(target.workloads)
                            .then(() => setAsked(null))
                            .catch(() => undefined)
                    }
                />
            )}
            {issued && <RotatedDialog issued={issued} onClose={() => setIssued(null)} />}
            <ErrorLine error={issue.error ?? save.error} />
        </>
    );
}
