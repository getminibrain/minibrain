import { IconCopy, IconDots, IconKey, IconRefresh, IconSettings } from "@tabler/icons-react";
import {
    Button,
    ConfirmDialog,
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
    useToast,
} from "obp-ui";
import { useState } from "react";
import { type PoolToken, type PoolTokenIssued, useIssueJoinToken } from "~/api/joinTokenQueries";
import { ErrorLine } from "~/components/Section";
import { LOCAL_POOL, RotatedDialog } from "./PoolJoin";
import { PoolSettingsDialog } from "./PoolUse";
import { workerCommand } from "./commands";
import type { PoolInfo } from "./parts";

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
    const copy = useCopy(pool.name);
    const [rotating, setRotating] = useState(false);
    const [settings, setSettings] = useState(false);
    const [issued, setIssued] = useState<PoolTokenIssued | null>(null);
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
                    <DropdownMenuItem onSelect={() => setSettings(true)}>
                        <IconSettings aria-hidden="true" />
                        Pool settings
                    </DropdownMenuItem>
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
            {settings && (
                <PoolSettingsDialog
                    pool={pool.name}
                    workloads={pool.workloads}
                    description={pool.description ?? ""}
                    onClose={() => setSettings(false)}
                />
            )}
            {issued && <RotatedDialog issued={issued} onClose={() => setIssued(null)} />}
            <ErrorLine error={issue.error} />
        </>
    );
}
