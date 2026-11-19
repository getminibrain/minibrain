import { IconShieldCheck, IconStopwatch } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
    Badge,
    Button,
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    Field,
    Link,
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
    SettingsGroup,
    SettingsRow,
    Textarea,
} from "obp-ui";
import { type ComponentProps, type FormEvent, Fragment, useMemo, useState } from "react";
import { api, unwrap } from "~/api/client";
import { PROBLEMS_KEY } from "~/api/problemQueries";
import type { components } from "~/api/schema";
import { ErrorLine, errorMessage } from "~/components/Section";
import { SettingsSection } from "~/components/SettingsSection";
import { StatusText, type Tone } from "~/components/models/StatusText";
import { useCan } from "~/lib/access";
import { count } from "~/lib/format";
import { relativeTime } from "~/lib/time";
import { SECURITY } from "~/pages/settings/settingsIndex";

type PolicyInfo = components["schemas"]["PolicyInfo"];
type ChainInfo = components["schemas"]["AuditChainInfo"];
type SiemInfo = components["schemas"]["SiemInfo"];
type ChainBreak = components["schemas"]["ChainBreakRecord"];

export const RETENTION = "audit_retention_days";
const EXPORT_HREF = `/settings/security#${SECURITY.auditExport.anchor}`;
const SETTINGS_HREF = `/settings/security#${SECURITY.auditIntegrity.anchor}`;
const DAY_MS = 24 * 3600 * 1000;
const NOTE_MAX = 500;
const STANDARD_DAYS = 365;
const RETENTION_CHOICES: [number, string][] = [
    [0, "Keep forever"],
    [2555, "7 years"],
    [1095, "3 years"],
    [365, "1 year"],
    [180, "180 days"],
    [90, "90 days"],
];

const CHAIN_KEY = ["audit", "chain"] as const;

export function useChain() {
    const client = useQueryClient();
    return useQuery({
        queryKey: CHAIN_KEY,
        queryFn: async () => {
            const chain = await unwrap(api.GET("/api/audit/chain"));
            if (chain.broken) {
                void client.invalidateQueries({ queryKey: PROBLEMS_KEY });
                void client.invalidateQueries({
                    predicate: (query) =>
                        query.queryKey[0] === "audit" && query.queryKey[1] !== "chain",
                });
            }
            return chain;
        },
    });
}

function seqRange(first: number, last: number): string {
    return first === last ? `seq ${count(first)}` : `seq ${count(first)} to ${count(last)}`;
}

function events(total: number): string {
    return `${count(total)} ${total === 1 ? "event" : "events"}`;
}

function queued(total: number): string {
    return total === 1 ? "1 event waits" : `${count(total)} events wait`;
}

function openBreaks(chain: ChainInfo): ChainBreak[] {
    return chain.breaks.filter((found) => found.acknowledged_at === null);
}

function liveRecord(chain: ChainInfo): ChainBreak | null {
    const live = chain.broken;
    if (live === null) {
        return null;
    }
    return (
        chain.breaks.find((found) => found.seq === live.seq && found.reason === live.reason) ?? null
    );
}

function liveAcknowledged(chain: ChainInfo): boolean {
    return (liveRecord(chain)?.acknowledged_at ?? null) !== null;
}

function liveStatus(chain: ChainInfo): string {
    const record = liveRecord(chain);
    if (record === null) {
        return "This break is not in the history yet. The next scheduled check records it, the nightly full check at the latest, and then an admin can acknowledge it.";
    }
    return record.acknowledged_at
        ? "This break is acknowledged and kept in the history below."
        : "The break stays recorded until an admin acknowledges it.";
}

function unacknowledgedSeq(chain: ChainInfo): number | null {
    if (chain.broken && !liveAcknowledged(chain)) {
        return chain.broken.seq;
    }
    return openBreaks(chain)[0]?.seq ?? null;
}

function earlierBreaks(chain: ChainInfo): string | null {
    const open = openBreaks(chain).filter(
        (found) => found.seq !== chain.broken?.seq || found.reason !== chain.broken?.reason,
    ).length;
    if (open === 0) {
        return null;
    }
    return open === 1
        ? "A break found earlier is not acknowledged yet; it stays open until an admin acknowledges it."
        : `${count(open)} breaks found earlier are not acknowledged yet; they stay open until an admin acknowledges them.`;
}

function chainText(chain: ChainInfo): string {
    const parts: string[] = [];
    if (chain.broken) {
        const intact =
            chain.events > 0 ? ` Events up to seq ${count(chain.last_seq)} are intact.` : "";
        parts.push(
            `Seq ${count(chain.broken.seq)}: ${chain.broken.reason}.${intact} Compare it with your SIEM's copy or an earlier export to see what changed.`,
        );
        parts.push(liveStatus(chain));
    } else if (chain.events > 0 && chain.first_seq !== null) {
        parts.push(
            `${events(chain.events)}, ${seqRange(chain.first_seq, chain.last_seq)}, match their hashes and link to the one before.`,
        );
    } else {
        parts.push("Each event is sealed into the chain within seconds of being recorded.");
    }
    const earlier = earlierBreaks(chain);
    if (earlier) {
        parts.push(earlier);
    }
    if (!chain.broken && chain.anchor_seq > 0) {
        parts.push(
            `The chain starts where the last prune cut it, after seq ${count(chain.anchor_seq)}.`,
        );
    }
    if (!chain.broken && chain.pending > 0) {
        parts.push(`${events(chain.pending)} not sealed yet.`);
    }
    return parts.join(" ");
}

function ChainBadge({ chain }: { chain: ChainInfo | undefined }) {
    if (!chain) {
        return <Badge variant="neutral">Checking</Badge>;
    }
    const seq = unacknowledgedSeq(chain);
    if (seq !== null) {
        return <Badge variant="destructive">{`Broken at seq ${count(seq)}`}</Badge>;
    }
    return chain.broken ? (
        <Badge variant="warning">Broken, acknowledged</Badge>
    ) : (
        <Badge variant="success">Verified</Badge>
    );
}

function sentence(text: string): string {
    return text.charAt(0).toUpperCase() + text.slice(1);
}

function AcknowledgeDialog({ found, onClose }: { found: ChainBreak | null; onClose: () => void }) {
    const client = useQueryClient();
    const [note, setNote] = useState("");
    const acknowledge = useMutation({
        mutationFn: ({ id, text }: { id: number; text: string }) =>
            unwrap(
                api.POST("/api/audit/chain/breaks/{break_id}/acknowledge", {
                    params: { path: { break_id: id } },
                    body: { note: text },
                }),
            ),
        onSuccess: async () => {
            close();
            await Promise.all([
                client.invalidateQueries({ queryKey: ["audit"] }),
                client.invalidateQueries({ queryKey: PROBLEMS_KEY }),
            ]);
        },
    });
    const close = () => {
        setNote("");
        acknowledge.reset();
        onClose();
    };
    const text = note.trim();
    const submit = (event: FormEvent) => {
        event.preventDefault();
        if (found && text) {
            acknowledge.mutate({ id: found.id, text });
        }
    };
    return (
        <Dialog open={found !== null} onOpenChange={(open) => !open && close()}>
            <DialogContent>
                <form onSubmit={submit} className="flex flex-col gap-6">
                    <DialogHeader>
                        <DialogTitle>
                            {found ? `Acknowledge the break at seq ${count(found.seq)}` : ""}
                        </DialogTitle>
                        <DialogDescription>
                            {found
                                ? `${sentence(found.reason)}. Acknowledging clears the alert; the break stays in the history and the audit log records your note.`
                                : ""}
                        </DialogDescription>
                    </DialogHeader>
                    <Field
                        id="break-note"
                        label="Note"
                        hint="What you found and what you did about it."
                    >
                        <Textarea
                            id="break-note"
                            rows={4}
                            maxLength={NOTE_MAX}
                            value={note}
                            onChange={(event) => setNote(event.target.value)}
                        />
                    </Field>
                    <ErrorLine error={acknowledge.error} />
                    <DialogFooter>
                        <Button type="button" variant="outline" onClick={close}>
                            Cancel
                        </Button>
                        <Button type="submit" disabled={acknowledge.isPending || !text}>
                            {acknowledge.isPending ? "Acknowledging…" : "Acknowledge"}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}

function acknowledgement(found: ChainBreak): string {
    const who = found.acknowledged_by_name ?? found.acknowledged_by ?? "an admin";
    const when = found.acknowledged_at ? relativeTime(found.acknowledged_at) : "";
    return `Acknowledged by ${who}, ${when}: ${found.note ?? ""}`;
}

function BreakItem({
    found,
    canAcknowledge,
    onAcknowledge,
}: {
    found: ChainBreak;
    canAcknowledge: boolean;
    onAcknowledge: () => void;
}) {
    return (
        <li className="flex items-start justify-between gap-4 px-3 py-2">
            <div className="flex min-w-0 flex-col gap-0.5">
                <p className="tabular-nums">
                    <span className="font-medium">{`Seq ${count(found.seq)}`}</span>
                    {`: ${found.reason}`}
                </p>
                <p className="text-sm text-muted-foreground">
                    {`Found ${relativeTime(found.found_at)} by the ${found.found_by} check`}
                </p>
                {found.acknowledged_at ? (
                    <p className="text-sm break-words text-muted-foreground">
                        {acknowledgement(found)}
                    </p>
                ) : (
                    <p className="text-sm text-destructive">Not acknowledged</p>
                )}
            </div>
            {canAcknowledge && !found.acknowledged_at && (
                <Button variant="outline" onClick={onAcknowledge}>
                    Acknowledge…
                </Button>
            )}
        </li>
    );
}

function BreaksRow({ breaks }: { breaks: ChainBreak[] }) {
    const can = useCan();
    const [acknowledging, setAcknowledging] = useState<ChainBreak | null>(null);
    if (breaks.length === 0) {
        return null;
    }
    const open = breaks.filter((found) => found.acknowledged_at === null).length;
    return (
        <SettingsRow
            anchor={SECURITY.auditIntegrity.settings.breaks.anchor}
            label={SECURITY.auditIntegrity.settings.breaks.label}
            description={
                open > 0
                    ? `${count(open)} not acknowledged. Every break stays here for good.`
                    : "All acknowledged. Every break stays here for good."
            }
            control={null}
        >
            <ul className="mb-3 flex flex-col divide-y rounded-lg border">
                {breaks.map((found) => (
                    <BreakItem
                        key={found.id}
                        found={found}
                        canAcknowledge={can.admin}
                        onAcknowledge={() => setAcknowledging(found)}
                    />
                ))}
            </ul>
            <AcknowledgeDialog found={acknowledging} onClose={() => setAcknowledging(null)} />
        </SettingsRow>
    );
}

type SiemState = {
    variant: ComponentProps<typeof Badge>["variant"];
    label: string;
    detail: string;
};

function siemState(siem: SiemInfo): SiemState {
    if (!siem.target) {
        return { variant: "neutral", label: "Off", detail: "Events stay on this install." };
    }
    const when = siem.forwarded_at ? `, ${relativeTime(siem.forwarded_at)}` : "";
    const sent =
        siem.forwarded_seq > 0
            ? `Sent up to seq ${count(siem.forwarded_seq)}${when}.`
            : "Nothing sent yet.";
    if (siem.error) {
        return {
            variant: "destructive",
            label: "Failing",
            detail: `${siem.error}. ${sent} ${queued(siem.waiting)} and will go out in order once the SIEM answers.`,
        };
    }
    if (siem.waiting > 0) {
        return {
            variant: "info",
            label: "Sending",
            detail: `${sent} ${events(siem.waiting)} to go.`,
        };
    }
    return {
        variant: "success",
        label: "Up to date",
        detail: `${sent} Every sealed event is sent.`,
    };
}

const CHECKING: SiemState = { variant: "neutral", label: "Checking", detail: "" };

function SiemRow({ siem }: { siem: SiemInfo | undefined }) {
    const state = siem ? siemState(siem) : CHECKING;
    return (
        <SettingsRow
            anchor={SECURITY.auditIntegrity.settings.siemStatus.anchor}
            label={SECURITY.auditIntegrity.settings.siemStatus.label}
            description={
                <>
                    {siem?.target && (
                        <>
                            <span className="font-mono break-all">{siem.target}</span>
                            {". "}
                        </>
                    )}
                    {state.detail}{" "}
                    <Link href={EXPORT_HREF} className="text-primary hover:underline">
                        {siem?.target
                            ? "Change it under Audit log export"
                            : "Set it up under Audit log export"}
                    </Link>
                    {"."}
                </>
            }
            control={<Badge variant={state.variant}>{state.label}</Badge>}
        />
    );
}

export function AuditIntegrity() {
    const chain = useChain();
    return (
        <SettingsSection
            icon={IconShieldCheck}
            anchor={SECURITY.auditIntegrity.anchor}
            title={SECURITY.auditIntegrity.title}
            description="Every event carries a SHA-256 hash of its fields and of the event before it, so an edit or a deletion breaks the chain."
            actions={
                <Button
                    variant="outline"
                    disabled={chain.isFetching}
                    onClick={() => void chain.refetch()}
                >
                    {chain.isFetching ? "Verifying…" : "Verify again"}
                </Button>
            }
        >
            <SettingsGroup>
                <SettingsRow
                    anchor={SECURITY.auditIntegrity.settings.hashChain.anchor}
                    label={SECURITY.auditIntegrity.settings.hashChain.label}
                    description={chain.data ? chainText(chain.data) : "Checking every event…"}
                    error={errorMessage(chain.error)}
                    control={<ChainBadge chain={chain.data} />}
                />
                <BreaksRow breaks={chain.data?.breaks ?? []} />
                <SiemRow siem={chain.data?.siem} />
            </SettingsGroup>
        </SettingsSection>
    );
}

function retentionChoices(days: number): [number, string][] {
    return RETENTION_CHOICES.some(([value]) => value === days)
        ? RETENTION_CHOICES
        : [...RETENTION_CHOICES, [days, `${days.toLocaleString()} ${days === 1 ? "day" : "days"}`]];
}

export function retentionText(days: number): string {
    return retentionChoices(days).find(([value]) => value === days)?.[1] ?? `${days} days`;
}

function usePrunable(days: number) {
    const until = useMemo(() => new Date(Date.now() - days * DAY_MS).toISOString(), [days]);
    return useQuery({
        queryKey: ["audit", "prunable", days],
        queryFn: () => unwrap(api.GET("/api/audit", { params: { query: { until, limit: 1 } } })),
        enabled: days > 0,
    });
}

export function AuditRetention({ policy }: { policy: PolicyInfo }) {
    const client = useQueryClient();
    const days = typeof policy.value === "number" ? policy.value : 0;
    const prunable = usePrunable(days);
    const change = useMutation({
        mutationFn: (value: number) =>
            unwrap(
                api.PUT("/api/policies/{name}", {
                    params: { path: { name: RETENTION } },
                    body: { value },
                }),
            ),
        onSuccess: async (policies) => {
            client.setQueryData(["policies"], policies);
            await client.invalidateQueries({ queryKey: ["audit"] });
        },
    });
    const older = prunable.data?.total ?? 0;
    const control = policy.locked ? (
        <>
            <span>{retentionText(days)}</span>
            <Badge variant="neutral">
                {policy.source === "environment" ? "Set by environment" : "Set by config file"}
            </Badge>
        </>
    ) : (
        <Select value={String(days)} onValueChange={(next) => change.mutate(Number(next))}>
            <SelectTrigger
                id="audit-retention"
                aria-describedby="audit-retention-description"
                className="w-44"
            >
                <SelectValue>{retentionText(days)}</SelectValue>
            </SelectTrigger>
            <SelectContent>
                {retentionChoices(days).map(([value, label]) => (
                    <SelectItem key={value} value={String(value)}>
                        {label}
                    </SelectItem>
                ))}
            </SelectContent>
        </Select>
    );
    return (
        <SettingsSection
            icon={IconStopwatch}
            anchor={SECURITY.auditRetention.anchor}
            title={SECURITY.auditRetention.title}
            description="How long the audit log keeps events."
        >
            <SettingsGroup>
                <SettingsRow
                    id={policy.locked ? undefined : "audit-retention"}
                    anchor={SECURITY.auditRetention.settings.keep.anchor}
                    label={SECURITY.auditRetention.settings.keep.label}
                    description={
                        days === 0
                            ? "Every event is kept. Pick a period to delete older events for good."
                            : `Events older than ${retentionText(days).toLowerCase()} are deleted for good, checked every hour. Each deletion is itself recorded in the audit log.`
                    }
                    error={errorMessage(change.error)}
                    disabled={policy.locked}
                    control={control}
                >
                    {days > 0 && days < STANDARD_DAYS && policy.detail && (
                        <p className="pb-2.5 text-warning">{policy.detail}</p>
                    )}
                    {days > 0 && (
                        <p className="pb-2.5 text-warning">
                            {older > 0
                                ? `${count(older)} ${older === 1 ? "event is" : "events are"} older than that and will be deleted within the hour. Export them first if you need a copy.`
                                : "Deleted events cannot be restored. Export the log first if you need a copy."}
                        </p>
                    )}
                </SettingsRow>
            </SettingsGroup>
        </SettingsSection>
    );
}

function chainStatus(chain: ChainInfo | undefined, failed: boolean): [Tone, string] {
    if (failed) {
        return ["warning", "Chain not checked"];
    }
    if (!chain) {
        return ["neutral", "Checking the chain"];
    }
    const seq = unacknowledgedSeq(chain);
    if (seq !== null) {
        return ["destructive", `Chain broken at seq ${count(seq)}, not acknowledged`];
    }
    return chain.broken ? ["warning", "Chain broken, acknowledged"] : ["success", "Chain verified"];
}

function siemStatus(siem: SiemInfo | undefined): string | null {
    if (!siem?.target) {
        return null;
    }
    const state = siemState(siem);
    return state.variant === "destructive" ? "SIEM failing" : `SIEM ${state.label.toLowerCase()}`;
}

export function AuditStatus({ policy }: { policy: PolicyInfo | undefined }) {
    const chain = useChain();
    const [tone, chainText] = chainStatus(chain.data, chain.isError);
    const days = typeof policy?.value === "number" ? policy.value : null;
    const parts = [
        days === null ? null : days === 0 ? "Kept forever" : `Kept ${retentionText(days)}`,
        siemStatus(chain.data?.siem),
    ].filter((part): part is string => part !== null);
    return (
        <p className="flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground tabular-nums">
            <StatusText tone={tone} active={!chain.data && !chain.isError}>
                {chainText}
            </StatusText>
            {parts.map((part) => (
                <Fragment key={part}>
                    <span aria-hidden>·</span>
                    <span>{part}</span>
                </Fragment>
            ))}
            <span aria-hidden>·</span>
            <Link href={SETTINGS_HREF} className="text-primary hover:underline">
                Change in Settings
            </Link>
        </p>
    );
}
