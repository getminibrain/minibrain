import { Tooltip, TooltipContent, TooltipTrigger } from "obp-ui";
import type { ModelRow, VersionInfo } from "~/api/client";
import { useDatasetVersions } from "~/api/dataQueries";
import { useModel } from "~/api/queries";
import { StatusText } from "~/components/models/StatusText";
import { ruleText } from "~/lib/judging";
import { type Peers, type Phase, type RulePart, verdictLine } from "./versionState";

function useHeldOutRows(version: VersionInfo, enabled: boolean): number | null {
    const data = useDatasetVersions(version.dataset_slug ?? "", enabled);
    const found = data.data?.find((item) => item.id === version.dataset_version_id);
    return found?.counts.eval ?? null;
}

function RuleText({ rule, text }: { rule: RulePart; text: string }) {
    if (rule.met === null) {
        return <span className="shrink-0">no deploy rule set</span>;
    }
    const term = (
        <Tooltip>
            <TooltipTrigger asChild>
                <span className="cursor-help underline decoration-dotted underline-offset-4">
                    deploy rule
                </span>
            </TooltipTrigger>
            <TooltipContent className="max-w-xs whitespace-normal">{text}</TooltipContent>
        </Tooltip>
    );
    return (
        <span className="min-w-0 truncate">
            {rule.met ? "meets your " : "doesn't meet your "}
            {term}
            {rule.missed ? `: ${rule.missed}` : ""}
        </span>
    );
}

export function VerdictLine({
    row,
    version,
    phase,
    peers,
    eta,
}: {
    row: ModelRow;
    version: VersionInfo;
    phase: Phase;
    peers: Peers;
    eta: number | null | undefined;
}) {
    const rows = useHeldOutRows(version, phase === "scoring");
    const model = useModel(version.promotion ? row.key : "");
    const verdict = verdictLine({ version, phase, peers, eta, heldOutRows: rows });
    const rule = model.data ? ruleText(model.data.promotion) : "Loading the rule…";
    return (
        <p className="flex h-6 min-w-0 items-center" aria-live="polite">
            <StatusText
                tone={verdict.tone}
                active={verdict.active}
                waiting={verdict.waiting}
                progress={verdict.progress}
                className="min-w-0"
            >
                <span className="flex min-w-0 items-baseline gap-1 tabular-nums">
                    <span className="truncate" title={verdict.text}>
                        {verdict.text}
                    </span>
                    {verdict.rule && (
                        <>
                            <span className="shrink-0">·</span>
                            <RuleText rule={verdict.rule} text={rule} />
                        </>
                    )}
                </span>
            </StatusText>
        </p>
    );
}
