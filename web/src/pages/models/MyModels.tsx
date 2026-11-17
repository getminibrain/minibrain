import { Link } from "obp-ui";
import type { ModelRow } from "~/api/client";
import { When } from "~/components/When";
import { StatusText, type Tone } from "~/components/models/StatusText";
import { deploymentPageHref, modelPageHref } from "~/lib/modelLinks";

const DEPLOYMENT_TONES: Record<string, Tone> = {
    running: "success",
    starting: "info",
    unhealthy: "destructive",
    stopping: "info",
    stop_failed: "destructive",
};

const DEPLOYMENT_STATES: Record<string, string> = {
    running: "Live",
    starting: "Starting",
    unhealthy: "Unhealthy",
    stopping: "Stopping",
    stop_failed: "Stop failed",
};

export function Deployment({ row, short = false }: { row: ModelRow; short?: boolean }) {
    const { state } = row.deployment;
    const label = short ? (DEPLOYMENT_STATES[state] ?? row.deployment.label) : row.deployment.label;
    if (state === "not_deployed") {
        return <span className="text-muted-foreground">{label}</span>;
    }
    const href =
        row.kind === "custom" ? deploymentPageHref(row.key) : modelPageHref(row.key, "api");
    return (
        <Link href={href} className="hover:underline">
            <StatusText
                tone={DEPLOYMENT_TONES[state] ?? "neutral"}
                active={state === "starting" || state === "stopping"}
                waiting={state === "starting" && row.deployment.waiting}
            >
                {label}
            </StatusText>
        </Link>
    );
}

export function Updated({ value }: { value: string }) {
    return <When value={value} className="text-muted-foreground" />;
}
