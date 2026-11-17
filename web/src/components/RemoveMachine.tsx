import { ConfirmDialog } from "obp-ui";
import type { ReactNode } from "react";

export function RemoveMachineDialog({
    pool,
    host,
    trigger,
    onConfirm,
}: {
    pool: string;
    host: string;
    trigger: ReactNode;
    onConfirm: () => Promise<unknown>;
}) {
    return (
        <ConfirmDialog
            trigger={trigger}
            title={`Remove ${host} from pool ${pool}?`}
            description={`${host} leaves pool ${pool}. If its worker still runs, it stops at its next heartbeat; run minibrain worker there again to rejoin. Its finished jobs keep their history.`}
            confirmLabel="Remove"
            destructive
            onConfirm={onConfirm}
        />
    );
}
