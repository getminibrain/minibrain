import { Tooltip, TooltipContent, TooltipTrigger, cn } from "obp-ui";

export function MiddleTruncate({
    text,
    tail = 28,
    className,
}: { text: string; tail?: number; className?: string }) {
    const cut = text.length > tail * 2 ? text.length - tail : text.length;
    return (
        <Tooltip>
            <TooltipTrigger asChild>
                <span className={cn("inline-flex max-w-full min-w-0 font-mono", className)}>
                    <span className="truncate">{text.slice(0, cut)}</span>
                    <span className="shrink-0 whitespace-pre">{text.slice(cut)}</span>
                </span>
            </TooltipTrigger>
            <TooltipContent className="max-w-96 font-mono break-all">{text}</TooltipContent>
        </Tooltip>
    );
}
