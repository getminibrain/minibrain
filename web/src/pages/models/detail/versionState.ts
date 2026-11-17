import type { ModelRow, VersionInfo } from "~/api/client";
import type { Tone } from "~/components/models/StatusText";
import { count, points, pointsSize } from "~/lib/format";
import { durationText } from "~/lib/jobs";
import { missedText } from "~/lib/judging";
import { isDeployed } from "./header";
import { liveOf } from "./makeLive";
import { cancelling, finishedBeforeCancel, isCancelled } from "./versions";

export type Phase =
    | "queued"
    | "training"
    | "scoring"
    | "ready"
    | "failed"
    | "cancelled"
    | "deleting";

export const UNSCORED: Phase[] = ["queued", "training", "scoring"];

export function phaseOf(version: VersionInfo): Phase {
    if (version.status === "queued") {
        return "queued";
    }
    if (version.status === "training") {
        return version.job?.status === "queued" ? "queued" : "training";
    }
    if (version.status === "evaluating") {
        return "scoring";
    }
    if (isCancelled(version)) {
        return "cancelled";
    }
    if (version.status === "failed") {
        return "failed";
    }
    return version.status === "deleting" ? "deleting" : "ready";
}

export type Peers = {
    live: VersionInfo | undefined;
    zero: VersionInfo | undefined;
    isLive: boolean;
    starting: "deploying" | "waiting" | null;
};

export function peersOf(row: ModelRow, versions: VersionInfo[], version: VersionInfo): Peers {
    const live = isDeployed(row) ? liveOf(versions) : undefined;
    const zero = versions.find((item) => item.number === 0);
    return {
        live: live && live.number !== version.number ? live : undefined,
        zero: zero && zero.number !== version.number ? zero : undefined,
        isLive: live?.number === version.number,
        starting:
            live?.number !== version.number || row.deployment.state !== "starting"
                ? null
                : row.deployment.waiting
                  ? "waiting"
                  : "deploying",
    };
}

export function scored(version: VersionInfo | undefined): version is VersionInfo {
    return Boolean(version && version.status === "ready" && version.score !== null);
}

export function referenceOf(peers: Peers): { version: VersionInfo; label: string } | null {
    if (scored(peers.live)) {
        return { version: peers.live, label: `live v${peers.live.number}` };
    }
    if (scored(peers.zero)) {
        return { version: peers.zero, label: "baseline v0" };
    }
    return null;
}

export function noiseBand(mine: number, theirs: number, rows: number): number {
    if (rows <= 0) {
        return Number.POSITIVE_INFINITY;
    }
    return 2 * Math.sqrt((mine * (1 - mine) + theirs * (1 - theirs)) / rows);
}

export function withinNoise(mine: number, theirs: number, rows: number): boolean {
    return Math.abs(mine - theirs) <= noiseBand(mine, theirs, rows);
}

export function pts(delta: number): string {
    return `${points(delta)} pts`;
}

const SHORT_REASON = 140;

export function shortReason(text: string | null | undefined): string {
    const line =
        (text ?? "")
            .split("\n")
            .find((part) => part.trim())
            ?.trim() ?? "";
    if (!line) {
        return "no reason was recorded";
    }
    return line.length > SHORT_REASON ? `${line.slice(0, SHORT_REASON - 1)}…` : line;
}

export type VerdictText = {
    tone: Tone;
    text: string;
    active?: boolean;
    waiting?: boolean;
    progress?: number | null;
    rule?: RulePart;
};

function running(progress: number): Pick<VerdictText, "active" | "progress"> {
    return progress > 0 ? { progress } : { active: true };
}

export function verdictLine({
    version,
    phase,
    peers,
    eta,
    heldOutRows,
}: {
    version: VersionInfo;
    phase: Phase;
    peers: Peers;
    eta: number | null | undefined;
    heldOutRows: number | null;
}): VerdictText {
    const share = (version.job?.progress ?? 0) * 100;
    const progress = Math.round(share);
    if (cancelling(version) && UNSCORED.includes(phase)) {
        return { tone: "warning", text: "Cancelling…", active: true };
    }
    if (phase === "queued") {
        return {
            tone: "neutral",
            text: "Queued · waiting for a worker to start training",
            waiting: true,
        };
    }
    if (phase === "training") {
        const left = typeof eta === "number" ? ` · about ${durationText(eta)} left` : "";
        return { tone: "info", text: `Training · ${progress}%${left}`, ...running(share) };
    }
    if (phase === "scoring" && version.job?.status === "queued") {
        return {
            tone: "neutral",
            text: "Queued · waiting for a worker to start scoring",
            waiting: true,
        };
    }
    if (phase === "scoring") {
        const rows = heldOutRows ? `${count(heldOutRows)} held-out rows` : "held-out rows";
        return { tone: "info", text: `Scoring on ${rows} · ${progress}%`, ...running(share) };
    }
    if (phase === "failed") {
        const what = version.job?.kind === "eval" ? "Scoring" : "Training";
        return { tone: "destructive", text: `${what} failed: ${shortReason(version.job?.error)}` };
    }
    if (phase === "cancelled") {
        const text = finishedBeforeCancel(version)
            ? "Finished before the cancel took effect"
            : "Cancelled";
        return { tone: "neutral", text };
    }
    if (phase === "deleting") {
        return { tone: "neutral", text: "Deleting", active: true };
    }
    return readyVerdict(version, peers);
}

export type RulePart = { met: boolean | null; missed: string | null };

export function rulePart(version: VersionInfo): RulePart {
    const checks = version.promotion?.checks ?? [];
    if (checks.length === 0) {
        return { met: null, missed: null };
    }
    const met = version.promotion?.passed ?? false;
    return { met, missed: met ? null : missedText(checks) };
}

function versusLive(delta: number, number: number): string {
    const size = pointsSize(delta);
    if (Number(size) === 0) {
        return `Same as live v${number}`;
    }
    return `${size} pts ${delta > 0 ? "better" : "worse"} than live v${number}`;
}

function readyVerdict(version: VersionInfo, peers: Peers): VerdictText {
    if (version.score === null) {
        return { tone: "neutral", text: "Not scored" };
    }
    const versusZero = scored(peers.zero)
        ? ` · ${pts(version.score - (peers.zero.score ?? 0))} vs baseline v0`
        : "";
    if (peers.starting === "waiting") {
        return { tone: "warning", text: `Waiting for a machine${versusZero}`, waiting: true };
    }
    if (peers.starting === "deploying") {
        return { tone: "info", text: `Deploying${versusZero}`, active: true };
    }
    if (peers.isLive) {
        return { tone: "success", text: `Live${versusZero}` };
    }
    if (version.number === 0 && !scored(peers.live)) {
        return {
            tone: "neutral",
            text: "No live version yet · the baseline every trained version is scored against",
        };
    }
    const rule = rulePart(version);
    if (!scored(peers.live)) {
        return {
            tone: rule.met === false ? "warning" : "neutral",
            text: `No live version yet${versusZero}`,
            rule,
        };
    }
    const delta = version.score - (peers.live.score ?? 0);
    const worse = delta < 0 && Number(pointsSize(delta)) > 0;
    const tone: Tone = rule.met === false || worse ? "warning" : rule.met ? "success" : "neutral";
    return { tone, text: versusLive(delta, peers.live.number), rule };
}
