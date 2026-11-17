import { IconDeviceSdCard, IconServer, type TablerIcon } from "@tabler/icons-react";
import type { ReactNode } from "react";
import type { FitInfo, TrainFitInfo } from "~/api/client";
import { SummaryLine } from "~/components/CreateLayout";
import { PoolLink } from "~/components/PoolLink";
import { UsageGauge } from "~/components/UsageGauge";
import { StatusText } from "~/components/models/StatusText";
import { bytes } from "~/lib/time";
import type { DiskNeed } from "./BaseSummary";
import { type PoolFit, runnable } from "./runsHere";

const LOW_SPACE = 5 * 1024 ** 3;
function Figures({ icon, children }: { icon: TablerIcon; children: ReactNode }) {
    return (
        <SummaryLine icon={icon} className="tabular-nums">
            {children}
        </SummaryLine>
    );
}

function Where({ children }: { children: ReactNode }) {
    return (
        <SummaryLine icon={IconServer} className="text-muted-foreground">
            {children}
        </SummaryLine>
    );
}

export type WeightsStore = {
    kind: "folder" | "s3";
    label: string;
    stagingFree: number | null | undefined;
};

export const MAIN_POOL = "local";

function FolderPlace({ label }: { label: string }) {
    return (
        <Where>
            {`${label} in `}
            <PoolLink name={MAIN_POOL} />
        </Where>
    );
}

export function DiskGauge({
    need,
    free,
    total,
    onDisk,
    store,
}: {
    need: DiskNeed;
    free: number | null | undefined;
    total: number | null | undefined;
    onDisk: number | null;
    store: WeightsStore;
}) {
    const place = <FolderPlace label={store.label} />;
    const size = need?.size ?? onDisk;
    const amount = size === null ? "Size unknown" : `${bytes(size)} ${need ? "needed" : "on disk"}`;
    if (store.kind === "s3") {
        const staging =
            store.stagingFree === null || store.stagingFree === undefined
                ? null
                : `${bytes(store.stagingFree)} free on main's disk to pass through`;
        return (
            <>
                <Figures icon={IconDeviceSdCard}>
                    {[amount, staging].filter(Boolean).join(" · ")}
                </Figures>
                <Where>{`${store.label}: S3 reports no free space, so the bucket's quota is the limit.`}</Where>
            </>
        );
    }
    if (free === null || free === undefined || !total) {
        return (
            <>
                <Figures icon={IconDeviceSdCard}>{`${amount} · free space unknown`}</Figures>
                {place}
            </>
        );
    }
    const download = need?.size ?? 0;
    const here = need ? 0 : (onDisk ?? 0);
    const others = Math.max(0, total - free - here);
    return (
        <>
            <UsageGauge
                label="Storage for model files"
                capacity={total}
                low={free - download < LOW_SPACE}
                segments={[
                    {
                        key: "other",
                        kind: "other",
                        label: "Other files on the disk",
                        legend: "Other files",
                        bytes: others,
                    },
                    {
                        key: "model",
                        kind: "weights",
                        label: need ? "This model's download" : "This model",
                        legend: need ? "To download" : "This model",
                        bytes: download || here,
                        planned: Boolean(need),
                    },
                ]}
            />
            {place}
        </>
    );
}

type Verdict = { text: string; tone: "success" | "warning" | "destructive" | "muted" };

function verdict(fit: FitInfo | null, trainFit: TrainFitInfo | null, servesOnly: boolean): Verdict {
    if (!fit || !fit.available_bytes || fit.level === "unknown") {
        return { text: "Not checked", tone: "muted" };
    }
    if (!runnable(fit.level)) {
        return { text: "Too small", tone: "destructive" };
    }
    if (servesOnly) {
        return { text: "Runs", tone: fit.level === "limited" ? "warning" : "success" };
    }
    if (trainFit?.level === "fits") {
        return { text: "Runs and trains", tone: "success" };
    }
    return { text: "Runs only", tone: "warning" };
}

function PoolRow({ pool, servesOnly }: { pool: PoolFit; servesOnly: boolean }) {
    const { fit } = pool;
    const result = verdict(fit, pool.trainFit, servesOnly);
    const available = fit?.available_bytes ?? 0;
    const needed = fit?.needed_bytes ?? 0;
    const short = needed > available;
    return (
        <li className="flex flex-col gap-1.5">
            <span className="flex items-center justify-between gap-3">
                <PoolLink name={pool.name} />
                {result.tone === "muted" ? (
                    <span className="text-muted-foreground">{result.text}</span>
                ) : (
                    <StatusText tone={result.tone}>{result.text}</StatusText>
                )}
            </span>
            {available > 0 && (
                <>
                    <UsageGauge
                        label={`Memory in pool ${pool.name}`}
                        capacity={available}
                        low={fit?.level === "limited"}
                        legend={false}
                        segments={[
                            {
                                key: "needs",
                                kind: "weights",
                                label: "This model",
                                bytes: needed,
                                planned: true,
                            },
                        ]}
                    />
                    <span className="text-sm text-muted-foreground tabular-nums">
                        {short
                            ? `Needs ${bytes(needed)} · has ${bytes(available)}`
                            : `${bytes(needed)} of ${bytes(available)} memory`}
                    </span>
                </>
            )}
        </li>
    );
}

export function PoolFitList({ pools, servesOnly }: { pools: PoolFit[]; servesOnly: boolean }) {
    if (pools.length === 0) {
        return <span className="text-muted-foreground">Unknown</span>;
    }
    return (
        <ul className="flex flex-col gap-4">
            {pools.map((pool) => (
                <PoolRow key={pool.name} pool={pool} servesOnly={servesOnly} />
            ))}
        </ul>
    );
}
