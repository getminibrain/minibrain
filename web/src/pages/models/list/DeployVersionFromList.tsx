import type { ModelRow } from "~/api/client";
import { useVersions } from "~/api/queries";
import { DeployVersionDialog } from "../detail/makeLive";

export type VersionToDeploy = { row: ModelRow; number: number };

function Loaded({ chosen, onClose }: { chosen: VersionToDeploy; onClose: () => void }) {
    const versions = useVersions(chosen.row.key);
    return (
        <DeployVersionDialog
            row={chosen.row}
            versions={versions.data ?? []}
            number={versions.data ? chosen.number : null}
            onOpenChange={(open) => !open && onClose()}
        />
    );
}

export function DeployVersionFromList({
    chosen,
    onClose,
}: {
    chosen: VersionToDeploy | null;
    onClose: () => void;
}) {
    return chosen ? (
        <Loaded key={`${chosen.row.key}@${chosen.number}`} chosen={chosen} onClose={onClose} />
    ) : null;
}
