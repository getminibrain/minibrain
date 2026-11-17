import { IconCheck, IconCopy } from "@tabler/icons-react";
import { Button, Tooltip, TooltipContent, TooltipTrigger } from "obp-ui";
import { useState } from "react";

type CopyState = "idle" | "copied" | "failed";

const MESSAGES: Record<CopyState, string | null> = {
    idle: null,
    copied: "Copied",
    failed: "This browser blocks copying here",
};

export function CopyButton({
    value,
    label,
    labelled = false,
}: { value: string; label: string; labelled?: boolean }) {
    const [state, setState] = useState<CopyState>("idle");
    const copy = () => {
        if (!navigator.clipboard) {
            setState("failed");
            return;
        }
        navigator.clipboard.writeText(value).then(
            () => setState("copied"),
            () => setState("failed"),
        );
    };
    return (
        <Tooltip>
            <TooltipTrigger asChild>
                <Button
                    type="button"
                    variant={labelled ? "outline" : "ghost"}
                    size={labelled ? "default" : "icon"}
                    aria-label={labelled ? undefined : label}
                    onClick={copy}
                    onPointerLeave={() => setState("idle")}
                    onBlur={() => setState("idle")}
                >
                    {state === "copied" ? (
                        <IconCheck aria-hidden="true" />
                    ) : (
                        <IconCopy aria-hidden="true" />
                    )}
                    {labelled && label}
                </Button>
            </TooltipTrigger>
            <TooltipContent>{MESSAGES[state] ?? label}</TooltipContent>
        </Tooltip>
    );
}
