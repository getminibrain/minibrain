import { KeyRound } from "lucide-react";
import {
    Badge,
    Button,
    ConfirmDialog,
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "obp-ui";
import { useState } from "react";
import { type JoinTokenInfo, useJoinTokens, useRevokeJoinToken } from "~/api/joinTokenQueries";
import { PoolLink } from "~/components/PoolLink";
import { ErrorLine, PanelSection } from "~/components/Section";
import { exactTime, relativeTime } from "~/lib/time";
import { roleLabel } from "./AddMachine";

function expiryText(token: JoinTokenInfo): string {
    if (!token.expires_at) {
        return "Never";
    }
    return exactTime(token.expires_at);
}

function lastUse(token: JoinTokenInfo) {
    if (!token.last_used_at) {
        return <span className="text-muted-foreground">Not used yet</span>;
    }
    return (
        <span>
            <span className="font-mono">{token.last_host}</span>
            <span className="text-muted-foreground">{` · ${relativeTime(token.last_used_at)}`}</span>
        </span>
    );
}

export function JoinTokens() {
    const tokens = useJoinTokens();
    const revoke = useRevokeJoinToken();
    const [revoking, setRevoking] = useState<JoinTokenInfo | null>(null);
    const rows = tokens.data ?? [];
    return (
        <PanelSection
            flush
            icon={KeyRound}
            anchor="join-tokens"
            title="Join tokens"
            description="Each token lets machines join one pool. Revoking one stops every machine that uses it."
        >
            <ErrorLine error={tokens.error ?? revoke.error} />
            <div className="overflow-x-auto">
                <Table>
                    <TableHeader>
                        <TableRow className="hover:bg-transparent">
                            <TableHead>Pool</TableHead>
                            <TableHead>Role</TableHead>
                            <TableHead>Token</TableHead>
                            <TableHead>Created</TableHead>
                            <TableHead>Expires</TableHead>
                            <TableHead>Last used by</TableHead>
                            <TableHead className="w-0" />
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {rows.length === 0 ? (
                            <TableRow className="hover:bg-transparent">
                                <TableCell
                                    colSpan={7}
                                    className="h-20 text-center text-muted-foreground"
                                >
                                    {tokens.isLoading
                                        ? "Loading join tokens…"
                                        : "No join tokens. Add machine creates one."}
                                </TableCell>
                            </TableRow>
                        ) : (
                            rows.map((token) => (
                                <TableRow key={token.id}>
                                    <TableCell>
                                        <PoolLink name={token.pool} />
                                    </TableCell>
                                    <TableCell>{roleLabel(token.role)}</TableCell>
                                    <TableCell className="font-mono">{`${token.prefix}…`}</TableCell>
                                    <TableCell
                                        title={`${exactTime(token.created_at)} by ${token.created_by}`}
                                    >
                                        {relativeTime(token.created_at)}
                                    </TableCell>
                                    <TableCell className="tabular-nums">
                                        {token.expired ? (
                                            <Badge variant="destructive">Expired</Badge>
                                        ) : (
                                            expiryText(token)
                                        )}
                                    </TableCell>
                                    <TableCell>{lastUse(token)}</TableCell>
                                    <TableCell>
                                        <Button
                                            variant="outline"
                                            onClick={() => setRevoking(token)}
                                            aria-label={`Revoke join token ${token.prefix} for pool ${token.pool}`}
                                        >
                                            Revoke
                                        </Button>
                                    </TableCell>
                                </TableRow>
                            ))
                        )}
                    </TableBody>
                </Table>
            </div>
            {revoking && (
                <ConfirmDialog
                    open
                    onOpenChange={(open) => !open && setRevoking(null)}
                    title={`Revoke join token ${revoking.prefix}…?`}
                    description={`Machines that joined pool ${revoking.pool} with it can no longer reach main. This cannot be undone.`}
                    confirmLabel="Revoke"
                    destructive
                    onConfirm={() =>
                        revoke
                            .mutateAsync(revoking.id)
                            .then(() => setRevoking(null))
                            .catch(() => undefined)
                    }
                />
            )}
        </PanelSection>
    );
}
