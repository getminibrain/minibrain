import { useQueryClient } from "@tanstack/react-query";
import { KeyRound, LoaderCircle, Plus } from "lucide-react";
import {
    Button,
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    Field,
    FieldGroup,
    Input,
    Label,
    Link,
    RadioGroup,
    RadioGroupItem,
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "obp-ui";
import { useEffect, useState } from "react";
import {
    type JoinRole,
    type JoinTokenCreated,
    useCreateJoinToken,
    useJoinTokens,
} from "~/api/joinTokenQueries";
import { ErrorLine } from "~/components/Section";
import { StatusText } from "~/components/models/StatusText";
import { Command, JOIN_ENV, joinCommands, machineHref } from "./NeedsALook";
import type { NodeInfo, PoolInfo } from "./parts";

const LOCAL_POOL = "local";
const NEW_POOL = "__new__";
const NEVER = "never";
const POOL_PATTERN = /^[a-z0-9][a-z0-9._-]{0,62}$/;
const EXPIRY_DAYS = ["1", "7", "30", "90", "365"];

const ROLE_CHOICES: { value: JoinRole; label: string; hint: string }[] = [
    {
        value: "worker",
        label: "Worker",
        hint: "Runs training and evaluation jobs, and serves the models deployed to the pool.",
    },
    {
        value: "engine",
        label: "Engine",
        hint: "Serves one model with minibrain engine, without running jobs.",
    },
    { value: "both", label: "Both", hint: "Runs a worker and a separate engine on the machine." },
];

export function roleOf(value: string): JoinRole {
    return ROLE_CHOICES.find((choice) => choice.value === value)?.value ?? "worker";
}

export function roleLabel(value: string): string {
    return ROLE_CHOICES.find((choice) => choice.value === value)?.label ?? value;
}

function expiryLabel(value: string): string {
    if (value === NEVER) {
        return "Never";
    }
    if (value === "365") {
        return "1 year";
    }
    return value === "1" ? "1 day" : `${value} days`;
}

function poolProblem(name: string, taken: string[]): string | null {
    if (!name) {
        return "Name the new pool.";
    }
    if (name === LOCAL_POOL) {
        return "The local pool is this machine; it needs no join token.";
    }
    if (!POOL_PATTERN.test(name)) {
        return "Up to 63 lowercase letters, digits, dots, dashes or underscores.";
    }
    return taken.includes(name) ? `Pool ${name} already exists; pick it above.` : null;
}

function joinedNode(pools: PoolInfo[], pool: string, host: string): NodeInfo | undefined {
    return pools.find((item) => item.name === pool)?.nodes.find((node) => node.host === host);
}

function Waiting({ created, pools }: { created: JoinTokenCreated; pools: PoolInfo[] }) {
    const client = useQueryClient();
    const tokens = useJoinTokens({ waiting: true });
    const host = tokens.data?.find((token) => token.id === created.id)?.last_host;
    useEffect(() => {
        if (host) {
            void client.invalidateQueries({ queryKey: ["compute", "pools"] });
        }
    }, [client, host]);
    if (!host) {
        return (
            <output className="inline-flex items-center gap-2 text-muted-foreground">
                <LoaderCircle
                    aria-hidden="true"
                    className="size-4 animate-spin motion-reduce:animate-none"
                />
                Waiting for the machine to join…
            </output>
        );
    }
    const node = joinedNode(pools, created.pool, host);
    return (
        <output className="inline-flex flex-wrap items-baseline gap-x-3">
            <StatusText tone="success">
                <span>
                    <span className="font-mono">{host}</span>
                    {` joined pool ${created.pool}`}
                </span>
            </StatusText>
            {node && (
                <Link href={machineHref(node)} className="text-primary hover:underline">
                    Open
                </Link>
            )}
        </output>
    );
}

function Created({ created, pools }: { created: JoinTokenCreated; pools: PoolInfo[] }) {
    const origin = window.location.origin;
    const commands = [
        `export ${JOIN_ENV}=${created.secret}`,
        ...joinCommands(roleOf(created.role), created.pool, origin),
    ];
    return (
        <div className="flex min-w-0 flex-col gap-field">
            <div className="flex min-w-0 flex-col gap-label">
                <span className="font-medium">Run this on the machine</span>
                <span className="text-sm text-muted-foreground">
                    {`The token is shown once. It joins pool ${created.pool} only; minibrain must be installed on the machine.`}
                </span>
                <div className="flex min-w-0 flex-col items-start gap-1.5">
                    {commands.map((command, index) => (
                        <Command
                            key={command}
                            value={command}
                            label={index === 0 ? "Copy the token line" : "Copy the command"}
                        />
                    ))}
                </div>
            </div>
            <Waiting created={created} pools={pools} />
        </div>
    );
}

function PoolChoice({
    names,
    value,
    onChange,
}: {
    names: string[];
    value: string;
    onChange: (value: string) => void;
}) {
    return (
        <Select value={value} onValueChange={(next) => onChange(String(next ?? NEW_POOL))}>
            <SelectTrigger id="join-pool" className="w-64">
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
    );
}

function RoleChoice({ value, onChange }: { value: JoinRole; onChange: (role: JoinRole) => void }) {
    return (
        <RadioGroup
            value={value}
            onValueChange={(next) => onChange(roleOf(String(next)))}
            className="flex flex-col gap-3"
            aria-label="Role"
        >
            {ROLE_CHOICES.map((choice) => (
                <Label key={choice.value} className="flex items-start gap-2 font-normal">
                    <RadioGroupItem value={choice.value} className="mt-0.5" />
                    <span className="flex flex-col">
                        <span>{choice.label}</span>
                        <span className="text-sm text-muted-foreground">{choice.hint}</span>
                    </span>
                </Label>
            ))}
        </RadioGroup>
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
    const names = [
        ...new Set([
            ...pools.map((pool) => pool.name),
            ...(tokens.data ?? []).map((token) => token.pool),
        ]),
    ].filter((name) => name !== LOCAL_POOL);
    const [picked, setPicked] = useState<string | null>(null);
    const [typed, setTyped] = useState("");
    const [role, setRole] = useState<JoinRole>("worker");
    const [expiry, setExpiry] = useState(NEVER);
    const [touched, setTouched] = useState(false);
    const create = useCreateJoinToken();
    const choice = picked ?? names[0] ?? NEW_POOL;
    const isNew = choice === NEW_POOL;
    const pool = isNew ? typed.trim() : choice;
    const problem = isNew ? poolProblem(pool, names) : null;
    const created = create.data ?? null;
    const close = (next: boolean) => {
        onOpenChange(next);
        if (!next) {
            create.reset();
            setPicked(null);
            setTyped("");
            setRole("worker");
            setExpiry(NEVER);
            setTouched(false);
        }
    };
    return (
        <Dialog open={open} onOpenChange={close}>
            <DialogContent className="sm:max-w-3xl">
                <form
                    onSubmit={(event) => {
                        event.preventDefault();
                        setTouched(true);
                        if (!problem && !created) {
                            create.mutate({
                                pool,
                                role,
                                expires_in_days: expiry === NEVER ? null : Number(expiry),
                            });
                        }
                    }}
                    noValidate
                    className="contents"
                >
                    <DialogHeader>
                        <DialogTitle>
                            {created ? `Join a machine to pool ${created.pool}` : "Add machine"}
                        </DialogTitle>
                        <DialogDescription>
                            {created
                                ? "Copy the token now: it is not shown again. Revoke it under Machines, Join tokens."
                                : "A join token lets one machine join one pool. Create one, then run the command it gives on the machine."}
                        </DialogDescription>
                    </DialogHeader>
                    {created ? (
                        <Created created={created} pools={pools} />
                    ) : (
                        <FieldGroup>
                            <Field
                                id="join-pool"
                                label="Pool"
                                hint="Machines in a pool share placement, prices and where models are served."
                            >
                                <PoolChoice names={names} value={choice} onChange={setPicked} />
                            </Field>
                            {isNew && (
                                <Field
                                    id="join-pool-name"
                                    label="New pool name"
                                    error={touched || typed ? (problem ?? undefined) : undefined}
                                >
                                    <Input
                                        id="join-pool-name"
                                        value={typed}
                                        onChange={(event) => setTyped(event.target.value)}
                                        onBlur={() => setTouched(true)}
                                        placeholder="gpu-a10"
                                        maxLength={63}
                                        className="w-64 font-mono"
                                        autoFocus
                                        aria-invalid={Boolean((touched || typed) && problem)}
                                    />
                                </Field>
                            )}
                            <div className="flex flex-col gap-label">
                                <span className="font-medium">Role</span>
                                <RoleChoice value={role} onChange={setRole} />
                            </div>
                            <Field
                                id="join-expiry"
                                label="Expires"
                                hint="The machine keeps using the token; once it expires the machine can no longer reach main."
                            >
                                <Select
                                    value={expiry}
                                    onValueChange={(next) => setExpiry(String(next ?? NEVER))}
                                >
                                    <SelectTrigger id="join-expiry" className="w-64">
                                        <SelectValue>{expiryLabel(expiry)}</SelectValue>
                                    </SelectTrigger>
                                    <SelectContent>
                                        {[NEVER, ...EXPIRY_DAYS].map((value) => (
                                            <SelectItem key={value} value={value}>
                                                {expiryLabel(value)}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </Field>
                        </FieldGroup>
                    )}
                    <ErrorLine error={create.error} />
                    <DialogFooter>
                        {created ? (
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
                                <Button
                                    type="submit"
                                    disabled={create.isPending || (touched && Boolean(problem))}
                                >
                                    <KeyRound aria-hidden="true" />
                                    Create token
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
                <Plus aria-hidden="true" />
                Add machine
            </Button>
            <AddMachineDialog pools={pools} open={open} onOpenChange={setOpen} />
        </>
    );
}
