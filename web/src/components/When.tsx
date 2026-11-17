import { Tooltip, TooltipContent, TooltipTrigger, cn } from "obp-ui";
import { exactTime, timeText } from "~/lib/time";

export function When({
    value,
    empty = "–",
    className,
}: {
    value: string | null | undefined;
    empty?: string;
    className?: string;
}) {
    if (!value) {
        return <span className="text-muted-foreground">{empty}</span>;
    }
    return (
        <Tooltip>
            <TooltipTrigger asChild>
                <time dateTime={value} className={cn("whitespace-nowrap tabular-nums", className)}>
                    {timeText(value)}
                </time>
            </TooltipTrigger>
            <TooltipContent>{exactTime(value)}</TooltipContent>
        </Tooltip>
    );
}
