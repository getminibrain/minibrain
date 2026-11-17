import { IconHistory } from "@tabler/icons-react";
import { Badge, Link, cn } from "obp-ui";
import type { ModelRow, VersionInfo } from "~/api/client";
import { PoolLink } from "~/components/PoolLink";
import { PanelSection } from "~/components/Section";
import { percent, points } from "~/lib/format";
import { modelPageHref, modelVersionHref } from "~/lib/modelLinks";
import { isDeployed } from "./header";
import { isBaseline, liveOf, versionLabel } from "./makeLive";
import { VersionStatus } from "./versions";

const SHOWN = 5;
const SAME = 0.0005;

function deltaTone(delta: number): string {
    if (delta > SAME) {
        return "text-success";
    }
    return delta < -SAME ? "text-destructive" : "text-muted-foreground";
}

function deltaOf(version: VersionInfo, live: VersionInfo | undefined): number | null {
    if (!live || live.number === version.number || live.score === null || version.score === null) {
        return null;
    }
    return version.score - live.score;
}

export function readyToDeploy(version: VersionInfo, live: VersionInfo | undefined): boolean {
    const delta = deltaOf(version, live);
    return (
        live !== undefined &&
        version.number > live.number &&
        version.status === "ready" &&
        !version.base_refusal &&
        !isBaseline(version) &&
        version.promotion?.passed === true &&
        delta !== null &&
        delta > SAME
    );
}

function LiveLine({ row, version }: { row: ModelRow; version: VersionInfo }) {
    const pool = row.deployment.pool;
    return (
        <>
            <Badge variant="success" className="shrink-0">
                Live
            </Badge>
            {pool && (
                <span className="flex min-w-0 shrink-0 items-baseline gap-1">
                    on
                    <PoolLink name={pool} />
                </span>
            )}
            {version.note && <span className="min-w-0 truncate">{`· ${version.note}`}</span>}
        </>
    );
}

function VersionLine({
    row,
    version,
    live,
}: {
    row: ModelRow;
    version: VersionInfo;
    live: VersionInfo | undefined;
}) {
    const isLive = live?.number === version.number;
    const delta = deltaOf(version, live);
    const ready = readyToDeploy(version, live);
    return (
        <li
            className={cn(
                "flex h-16 min-w-0 flex-col justify-center gap-0.5 px-4",
                isLive && "bg-primary/6",
            )}
        >
            <div className="flex min-w-0 items-center gap-3">
                <Link
                    href={modelVersionHref(row.key, version.number)}
                    className="shrink-0 font-medium tabular-nums hover:underline"
                >
                    {versionLabel(version)}
                </Link>
                {!isLive && (
                    <span className="min-w-0 truncate text-sm">
                        <VersionStatus row={row} version={version} />
                    </span>
                )}
                <span className="ml-auto shrink-0 tabular-nums">
                    {version.score === null ? "–" : percent(version.score)}
                </span>
            </div>
            <div className="flex min-w-0 items-center gap-2 text-sm text-muted-foreground">
                {isLive ? (
                    <LiveLine row={row} version={version} />
                ) : (
                    <>
                        {ready && (
                            <Badge variant="approval" className="shrink-0">
                                Ready to deploy
                            </Badge>
                        )}
                        {version.note && <span className="min-w-0 truncate">{version.note}</span>}
                    </>
                )}
                {delta !== null && (
                    <span className={cn("ml-auto shrink-0 tabular-nums", deltaTone(delta))}>
                        {`${points(delta)} vs live`}
                    </span>
                )}
            </div>
        </li>
    );
}

function recent(versions: VersionInfo[], live: VersionInfo | undefined): VersionInfo[] {
    const newest = [...versions].sort((a, b) => b.number - a.number);
    const top = newest.slice(0, SHOWN);
    if (!live || top.some((version) => version.number === live.number)) {
        return top;
    }
    return [...top.slice(0, SHOWN - 1), live];
}

export function VersionsPanel({ row, versions }: { row: ModelRow; versions: VersionInfo[] }) {
    const live = isDeployed(row) ? liveOf(versions) : undefined;
    const shown = recent(versions, live);
    return (
        <PanelSection
            icon={IconHistory}
            title="Versions"
            actions={
                <Link
                    href={modelPageHref(row.key, "versions")}
                    className="text-sm text-primary hover:underline"
                >
                    All versions
                </Link>
            }
            flush
        >
            <ol className="flex h-80 flex-col divide-y">
                {shown.length === 0 ? (
                    <li className="px-4 py-3 text-muted-foreground">No versions yet.</li>
                ) : (
                    shown.map((version) => (
                        <VersionLine key={version.number} row={row} version={version} live={live} />
                    ))
                )}
            </ol>
        </PanelSection>
    );
}
