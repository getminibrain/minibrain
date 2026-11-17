import { IconHourglass } from "@tabler/icons-react";
import {
    Button,
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "obp-ui";
import { useState } from "react";
import {
    type JoinRequestInfo,
    useApproveJoinRequest,
    useDenyJoinRequest,
    useJoinRequests,
} from "~/api/joinRequestQueries";
import { useJoinTokens } from "~/api/joinTokenQueries";
import { FormRows } from "~/components/FormRows";
import { PoolLink } from "~/components/PoolLink";
import { ErrorLine, PanelSection } from "~/components/Section";
import { StatusText } from "~/components/models/StatusText";
import { exactTime, relativeTime } from "~/lib/time";
import {
    type PoolChoice,
    PoolRows,
    choiceProblem,
    chosenPool,
    firstChoice,
    poolNames,
} from "./PoolJoin";
import { type HardwareFacts, hardwareText } from "./machines";
import type { PoolInfo } from "./parts";

function facts(request: JoinRequestInfo): HardwareFacts {
    const { gpus, accelerator_name, ram_bytes } = request.hardware;
    return {
        gpus: gpus ?? [],
        accelerator_name: accelerator_name ?? "",
        ram_bytes: ram_bytes ?? null,
    };
}

function ApproveDialog({
    request,
    names,
    onClose,
}: {
    request: JoinRequestInfo;
    names: string[];
    onClose: () => void;
}) {
    const approve = useApproveJoinRequest();
    const [value, setValue] = useState<PoolChoice>(() => firstChoice(names, request.pool));
    const [touched, setTouched] = useState(false);
    const problem = choiceProblem(value, names);
    return (
        <Dialog open onOpenChange={(open) => !open && onClose()}>
            <DialogContent className="sm:max-w-xl">
                <form
                    onSubmit={(event) => {
                        event.preventDefault();
                        setTouched(true);
                        if (!problem) {
                            approve
                                .mutateAsync({ id: request.id, pool: chosenPool(value) })
                                .then(onClose)
                                .catch(() => undefined);
                        }
                    }}
                    noValidate
                    className="contents"
                >
                    <DialogHeader>
                        <DialogTitle>{`Approve ${request.host}?`}</DialogTitle>
                        <DialogDescription>
                            {`Check that the machine printed code ${request.code}. It joins the pool you pick; removing it later revokes its access.`}
                        </DialogDescription>
                    </DialogHeader>
                    <FormRows labels="narrow">
                        <PoolRows
                            id="approve-pool"
                            names={names}
                            value={value}
                            onChange={setValue}
                            touched={touched}
                        />
                    </FormRows>
                    <ErrorLine error={approve.error} />
                    <DialogFooter>
                        <Button type="button" variant="outline" onClick={onClose}>
                            Cancel
                        </Button>
                        <Button
                            type="submit"
                            disabled={approve.isPending || (touched && Boolean(problem))}
                        >
                            Approve
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}

function RequestRow({
    request,
    onApprove,
}: {
    request: JoinRequestInfo;
    onApprove: (request: JoinRequestInfo) => void;
}) {
    const deny = useDenyJoinRequest();
    return (
        <TableRow className="hover:bg-transparent">
            <TableCell className="py-2">
                <StatusText tone="neutral" waiting>
                    Waiting
                </StatusText>
            </TableCell>
            <TableCell className="py-2 font-mono">
                <span className="block max-w-64 truncate" title={request.host}>
                    {request.host}
                </span>
            </TableCell>
            <TableCell className="max-w-56 py-2 whitespace-normal">
                {hardwareText(facts(request))}
            </TableCell>
            <TableCell className="py-2 font-mono">{request.code}</TableCell>
            <TableCell className="py-2">
                {request.pool ? (
                    <span className="block max-w-40 truncate" title={request.pool}>
                        <PoolLink name={request.pool} />
                    </span>
                ) : (
                    <span className="text-muted-foreground">Any</span>
                )}
            </TableCell>
            <TableCell
                className="py-2"
                title={`${exactTime(request.created_at)} from ${request.address ?? "an unknown address"}`}
            >
                {relativeTime(request.created_at)}
            </TableCell>
            <TableCell className="py-2">
                <span className="flex justify-end gap-2">
                    <Button type="button" onClick={() => onApprove(request)}>
                        Approve
                    </Button>
                    <Button
                        type="button"
                        variant="outline"
                        disabled={deny.isPending}
                        onClick={() => deny.mutate(request.id)}
                        aria-label={`Deny ${request.host}`}
                    >
                        Deny
                    </Button>
                </span>
                <ErrorLine error={deny.error} />
            </TableCell>
        </TableRow>
    );
}

export function JoinRequests({ pools }: { pools: PoolInfo[] }) {
    const requests = useJoinRequests();
    const tokens = useJoinTokens();
    const [approving, setApproving] = useState<JoinRequestInfo | null>(null);
    const rows = requests.data ?? [];
    if (rows.length === 0 && !requests.error) {
        return null;
    }
    return (
        <PanelSection
            flush
            icon={IconHourglass}
            anchor="waiting-for-approval"
            title="Waiting for approval"
            description="Machines that ran minibrain worker without a join token. Approve one only if it shows the same code."
        >
            <ErrorLine error={requests.error} />
            <div className="overflow-hidden rounded-md border bg-card">
                <Table>
                    <TableHeader>
                        <TableRow className="hover:bg-transparent">
                            <TableHead>Status</TableHead>
                            <TableHead>Machine</TableHead>
                            <TableHead>Hardware</TableHead>
                            <TableHead>Code</TableHead>
                            <TableHead>Asked for</TableHead>
                            <TableHead>Asked</TableHead>
                            <TableHead className="w-0" />
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {rows.map((request) => (
                            <RequestRow
                                key={request.id}
                                request={request}
                                onApprove={setApproving}
                            />
                        ))}
                    </TableBody>
                </Table>
            </div>
            {approving && (
                <ApproveDialog
                    request={approving}
                    names={poolNames(pools, tokens.data ?? [])}
                    onClose={() => setApproving(null)}
                />
            )}
        </PanelSection>
    );
}
