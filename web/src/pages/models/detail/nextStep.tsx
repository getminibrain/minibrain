import { IconRocket } from "@tabler/icons-react";
import { Button, Link } from "obp-ui";
import { useState } from "react";
import type { BaseModelDetail, ModelRow, VersionInfo } from "~/api/client";
import { StatusText, percentOf } from "~/components/models/StatusText";
import { useCan } from "~/lib/access";
import { trainHref } from "~/lib/modelLinks";
import { Tip, deployBlock, isDeployed } from "./header";
import { DeployVersionDialog } from "./makeLive";
import { UNSCORED, phaseOf } from "./versionState";

const SLOT = "flex h-8 min-w-0 items-center gap-3";

function neverLive(row: ModelRow, versions: VersionInfo[]): boolean {
    return !isDeployed(row) && !versions.some((version) => version.live_at);
}

function Scoring({ version }: { version: VersionInfo }) {
    const share = version.job?.progress ?? 0;
    return (
        <p className={SLOT}>
            <StatusText
                tone="info"
                active={share === 0}
                progress={share > 0 ? percentOf(share) : null}
                className="min-w-0"
            >
                <span className="truncate">
                    v0 is being scored. You can deploy it once that finishes.
                </span>
            </StatusText>
        </p>
    );
}

function Ready({
    row,
    base,
    versions,
}: {
    row: ModelRow;
    base: BaseModelDetail | undefined;
    versions: VersionInfo[];
}) {
    const can = useCan();
    const [number, setNumber] = useState<number | null>(null);
    const blocked = deployBlock(row, base);
    return (
        <div className={SLOT}>
            <StatusText tone="success" className="min-w-0">
                <span className="truncate">
                    v0 is ready. Deploy it to start answering at <code>/v1</code>, or train v1
                    first.
                </span>
            </StatusText>
            {can.build && (
                <>
                    <Tip tip={blocked}>
                        <Button
                            variant="outline"
                            size="sm"
                            disabled={Boolean(blocked)}
                            onClick={() => setNumber(0)}
                        >
                            <IconRocket aria-hidden="true" />
                            Deploy
                        </Button>
                    </Tip>
                    <Link
                        href={trainHref(row.key)}
                        className="shrink-0 text-primary hover:underline"
                    >
                        Train
                    </Link>
                    <DeployVersionDialog
                        row={row}
                        versions={versions}
                        number={number}
                        pick
                        onOpenChange={(open) => !open && setNumber(null)}
                    />
                </>
            )}
        </div>
    );
}

export function NextStep({
    row,
    base,
    versions,
}: {
    row: ModelRow;
    base: BaseModelDetail | undefined;
    versions: VersionInfo[];
}) {
    const zero = versions.find((version) => version.number === 0);
    if (!zero || !neverLive(row, versions)) {
        return null;
    }
    const phase = phaseOf(zero);
    if (UNSCORED.includes(phase)) {
        return <Scoring version={zero} />;
    }
    return phase === "ready" ? <Ready row={row} base={base} versions={versions} /> : null;
}
