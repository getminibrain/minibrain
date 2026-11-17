import { IconHistory } from "@tabler/icons-react";
import { Link, cn } from "obp-ui";
import type { ModelRow, VersionInfo } from "~/api/client";
import { PanelSection } from "~/components/Section";
import { percent, points } from "~/lib/format";
import { modelPageHref, modelVersionHref } from "~/lib/modelLinks";
import { Tip, isDeployed } from "./header";
import { SAME, deltaOf, liveOf, readyToDeploy, versionLabel } from "./makeLive";
import { phaseOf } from "./versionState";
import { VersionStatus, inFlight } from "./versions";

const SHOWN = 5;

function deltaTone(delta: number): string {
    if (delta > SAME) {
        return "text-success";
    }
    return delta < -SAME ? "text-destructive" : "text-muted-foreground";
}

function VersionName({ row, version }: { row: ModelRow; version: VersionInfo }) {
    return (
        <Tip tip={version.note}>
            <Link
                href={modelVersionHref(row.key, version.number)}
                className="block min-w-0 truncate font-medium tabular-nums hover:underline"
            >
                {versionLabel(version)}
            </Link>
        </Tip>
    );
}

function Marker({ isLive, ready }: { isLive: boolean; ready: boolean }) {
    if (isLive) {
        return <span className="text-sm text-muted-foreground">Live</span>;
    }
    return ready ? (
        <span className="text-sm whitespace-nowrap text-success">Ready to deploy</span>
    ) : null;
}

function RunLine({ share }: { share: number }) {
    return (
        <span aria-hidden="true" className="absolute inset-x-0 bottom-0 h-0.5 bg-info/15">
            {share > 0 ? (
                <span
                    className="block h-full bg-info/70 transition-[width] duration-150 motion-reduce:transition-none"
                    style={{ width: `${Math.min(100, share * 100)}%` }}
                />
            ) : (
                <span className="block h-full w-full bg-info/40 motion-safe:animate-pulse" />
            )}
        </span>
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
    const settled = phaseOf(version) === "ready";
    return (
        <li
            className={cn(
                "relative col-span-4 grid h-10 grid-cols-subgrid items-center px-4",
                isLive && "bg-primary/6",
            )}
        >
            <VersionName row={row} version={version} />
            {settled ? (
                <>
                    <span className="text-right tabular-nums">
                        {version.score === null ? "–" : percent(version.score)}
                    </span>
                    <span
                        className={cn(
                            "text-right text-sm whitespace-nowrap tabular-nums",
                            delta !== null && deltaTone(delta),
                        )}
                    >
                        {delta !== null && `${points(delta)} vs live`}
                    </span>
                    <span className="text-right">
                        <Marker isLive={isLive} ready={readyToDeploy(version, live)} />
                    </span>
                </>
            ) : (
                <span className="col-span-3 min-w-0 truncate text-sm">
                    <VersionStatus row={row} version={version} />
                </span>
            )}
            {inFlight(version) && <RunLine share={version.job?.progress ?? 0} />}
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
            <ol className="grid h-51 auto-rows-min grid-cols-[minmax(0,auto)_1fr_auto_auto] gap-x-3 divide-y">
                {shown.length === 0 ? (
                    <li className="col-span-4 flex h-10 items-center px-4 text-muted-foreground">
                        No versions yet.
                    </li>
                ) : (
                    shown.map((version) => (
                        <VersionLine key={version.number} row={row} version={version} live={live} />
                    ))
                )}
            </ol>
        </PanelSection>
    );
}
