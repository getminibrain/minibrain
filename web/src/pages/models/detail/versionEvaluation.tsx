import { IconGauge } from "@tabler/icons-react";
import { Button, Link } from "obp-ui";
import type { VersionInfo } from "~/api/client";
import { PanelSection } from "~/components/Section";
import { useCan } from "~/lib/access";
import { count } from "~/lib/format";
import { modelCompareHref } from "~/lib/modelLinks";
import { AnswerChanges, compareBlocked } from "./versionChanges";
import { NoiseNote, ScoreTable } from "./versionScore";
import { type Peers, type Phase, referenceOf } from "./versionState";

function CompareButton({
    slug,
    version,
    phase,
    peers,
}: { slug: string; version: VersionInfo; phase: Phase; peers: Peers }) {
    const can = useCan();
    const reference = referenceOf(peers);
    if (!reference || compareBlocked(version, phase, peers, can.build)) {
        return (
            <Button variant="outline" disabled>
                All in Compare →
            </Button>
        );
    }
    const other = reference.version.number;
    return (
        <Button variant="outline" asChild>
            <Link
                href={modelCompareHref(
                    slug,
                    Math.min(other, version.number),
                    Math.max(other, version.number),
                )}
            >
                All in Compare →
            </Link>
        </Button>
    );
}

export function EvaluationSection({
    slug,
    version,
    versions,
    phase,
    peers,
}: {
    slug: string;
    version: VersionInfo;
    versions: VersionInfo[];
    phase: Phase;
    peers: Peers;
}) {
    const held = version.held_out?.examples;
    const reference = referenceOf(peers);
    return (
        <PanelSection
            icon={IconGauge}
            title="Evaluation"
            tip={`Measured on ${held ? `${count(held)} ` : ""}held-out rows the version never trained on. Each change is v${version.number} against that column; shares change in points.${reference ? ` Bars are recall by label, the share of each label's rows answered right; the line marks ${reference.label}.` : ""}`}
            actions={<CompareButton slug={slug} version={version} phase={phase} peers={peers} />}
            flush
        >
            <ScoreTable version={version} versions={versions} phase={phase} peers={peers} />
            <div className="flex h-10 items-center border-t px-panel">
                <NoiseNote version={version} phase={phase} peers={peers} />
            </div>
            <div className="border-t p-panel">
                <AnswerChanges slug={slug} version={version} phase={phase} peers={peers} />
            </div>
        </PanelSection>
    );
}
