import { Tooltip, TooltipContent, TooltipTrigger } from "obp-ui";
import type { Teardown } from "~/lib/teardown";
import { StatusText } from "./StatusText";

export function TeardownStatus({ teardown }: { teardown: Teardown }) {
    const failed = teardown.state === "failed";
    const deleting = teardown.kind === "delete";
    return (
        <Tooltip>
            <TooltipTrigger asChild>
                <button type="button" className="flex items-center gap-2 rounded-sm text-left">
                    <StatusText tone={failed || deleting ? "destructive" : "info"} active={!failed}>
                        {teardown.label}
                    </StatusText>
                </button>
            </TooltipTrigger>
            <TooltipContent className="max-w-sm whitespace-normal">
                {teardown.detail}
            </TooltipContent>
        </Tooltip>
    );
}
