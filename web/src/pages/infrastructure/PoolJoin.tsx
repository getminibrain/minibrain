import { IconKey, IconRefresh } from "@tabler/icons-react";
import {
    Button,
    ConfirmDialog,
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    Input,
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "obp-ui";
import { useState } from "react";
import { type PoolToken, type PoolTokenIssued, useIssueJoinToken } from "~/api/joinTokenQueries";
import { CopyButton } from "~/components/CopyButton";
import { FormRow } from "~/components/FormRows";
import { ErrorLine } from "~/components/Section";
import { Command, tokenCommand, workerCommand } from "./commands";

export const LOCAL_POOL = "local";
const NEW_POOL = "__new__";
const POOL_PATTERN = /^[a-z0-9][a-z0-9._-]{0,62}$/;

export function poolProblem(name: string, taken: string[]): string | null {
    if (!name) {
        return "Name the new pool.";
    }
    if (name === LOCAL_POOL) {
        return "The local pool is main's own machine; no other machine joins it.";
    }
    if (!POOL_PATTERN.test(name)) {
        return "Up to 63 lowercase letters, digits, dots, dashes or underscores.";
    }
    return taken.includes(name) ? `Pool ${name} already exists; pick it above.` : null;
}

export type PoolChoice = { choice: string; typed: string };

export function chosenPool({ choice, typed }: PoolChoice): string {
    return choice === NEW_POOL ? typed.trim() : choice;
}

export function choiceProblem(value: PoolChoice, names: string[]): string | null {
    return value.choice === NEW_POOL ? poolProblem(chosenPool(value), names) : null;
}

export function firstChoice(names: string[], wanted?: string | null): PoolChoice {
    if (wanted && names.includes(wanted)) {
        return { choice: wanted, typed: "" };
    }
    if (wanted && wanted !== LOCAL_POOL) {
        return { choice: NEW_POOL, typed: wanted };
    }
    return { choice: names[0] ?? NEW_POOL, typed: "" };
}

export function PoolRows({
    id,
    names,
    value,
    onChange,
    touched,
}: {
    id: string;
    names: string[];
    value: PoolChoice;
    onChange: (value: PoolChoice) => void;
    touched: boolean;
}) {
    const problem = choiceProblem(value, names);
    const shown = touched || value.typed ? problem : null;
    return (
        <>
            <FormRow id={id} label="Pool">
                <Select
                    value={value.choice}
                    onValueChange={(next) =>
                        onChange({ ...value, choice: String(next ?? NEW_POOL) })
                    }
                >
                    <SelectTrigger id={id} className="w-64">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        {names.map((name) => (
                            <SelectItem key={name} value={name}>
                                {name}
                            </SelectItem>
                        ))}
                        <SelectItem value={NEW_POOL}>A new pool</SelectItem>
                    </SelectContent>
                </Select>
            </FormRow>
            {value.choice === NEW_POOL && (
                <FormRow id={`${id}-name`} label="New pool name" detail={shown ?? undefined}>
                    <Input
                        id={`${id}-name`}
                        value={value.typed}
                        onChange={(event) => onChange({ ...value, typed: event.target.value })}
                        placeholder="gpu-a10"
                        maxLength={63}
                        className="w-64 font-mono"
                        autoFocus
                        aria-invalid={Boolean(shown)}
                    />
                </FormRow>
            )}
        </>
    );
}

export function poolNames(pools: { name: string }[], tokens: PoolToken[]): string[] {
    return [
        ...new Set([...pools.map((pool) => pool.name), ...tokens.map((token) => token.pool)]),
    ].filter((name) => name !== LOCAL_POOL);
}

export function RotateToken({
    pool,
    exists,
    onIssued,
    size = "default",
}: {
    pool: string;
    exists: boolean;
    onIssued: (issued: PoolTokenIssued) => void;
    size?: "default" | "sm";
}) {
    const issue = useIssueJoinToken();
    const [confirming, setConfirming] = useState(false);
    const run = () =>
        issue
            .mutateAsync(pool)
            .then((issued) => {
                setConfirming(false);
                onIssued(issued);
            })
            .catch(() => undefined);
    return (
        <>
            <Button
                type="button"
                variant="outline"
                size={size}
                disabled={issue.isPending}
                onClick={() => (exists ? setConfirming(true) : run())}
                aria-label={
                    exists
                        ? `Rotate the join token for pool ${pool}`
                        : `Make a join token for pool ${pool}`
                }
            >
                {exists ? <IconRefresh aria-hidden="true" /> : <IconKey aria-hidden="true" />}
                {exists ? "Rotate" : "Make token"}
            </Button>
            <ConfirmDialog
                open={confirming}
                onOpenChange={setConfirming}
                title={`Rotate pool ${pool}'s join token?`}
                description="A new token replaces it. Machines and engines that joined with the old token are cut off at once and need the new one. Machines you approved stay."
                confirmLabel="Rotate"
                destructive
                onConfirm={run}
            />
            {issue.error && <ErrorLine error={issue.error} />}
        </>
    );
}

export function IssuedCommand({ issued, origin }: { issued: PoolTokenIssued; origin: string }) {
    return (
        <div className="flex min-w-0 flex-col gap-label">
            <span className="font-medium">Run this on the machine</span>
            <span className="text-sm text-muted-foreground">
                {`The token is shown only now and joins pool ${issued.pool} only.`}
            </span>
            <Command
                value={tokenCommand(issued.secret, issued.pool, origin)}
                label="Copy the command"
            />
        </div>
    );
}

function RotatedDialog({ issued, onClose }: { issued: PoolTokenIssued; onClose: () => void }) {
    return (
        <Dialog open onOpenChange={(open) => !open && onClose()}>
            <DialogContent className="sm:max-w-3xl">
                <DialogHeader>
                    <DialogTitle>{`New join token for pool ${issued.pool}`}</DialogTitle>
                    <DialogDescription>
                        {`Restart each token-joined machine in pool ${issued.pool} with it.`}
                    </DialogDescription>
                </DialogHeader>
                <IssuedCommand issued={issued} origin={window.location.origin} />
                <DialogFooter>
                    <Button type="button" onClick={onClose}>
                        Done
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

export function PoolJoinControls({ pool, token }: { pool: string; token: PoolToken | undefined }) {
    const [issued, setIssued] = useState<PoolTokenIssued | null>(null);
    return (
        <span className="ml-auto flex items-center gap-2">
            <span className="text-muted-foreground">
                {token ? (
                    <>
                        {"Token "}
                        <span className="font-mono text-foreground">{`${token.prefix}…`}</span>
                    </>
                ) : (
                    "No join token"
                )}
            </span>
            <CopyButton
                value={workerCommand(pool, window.location.origin)}
                label={`Copy the command that joins a machine to pool ${pool}`}
            />
            <RotateToken pool={pool} exists={Boolean(token)} size="sm" onIssued={setIssued} />
            {issued && <RotatedDialog issued={issued} onClose={() => setIssued(null)} />}
        </span>
    );
}
