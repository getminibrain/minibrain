import { StatusText } from "~/components/models/StatusText";
import type { PartialError } from "./actions";

export function PartialOutcome({
    outcome,
    done,
    failed,
}: {
    outcome: PartialError;
    done: string;
    failed: string;
}) {
    return (
        <div className="flex flex-col gap-3">
            {outcome.done.length > 0 && (
                <div className="flex flex-col gap-2">
                    <span className="font-medium">{`${done} ${outcome.done.length}`}</span>
                    <ul className="flex max-h-32 flex-col divide-y overflow-y-auto rounded-lg border">
                        {outcome.done.map((name, index) => (
                            <li key={`${index}:${name}`} className="truncate px-3 py-2">
                                {name}
                            </li>
                        ))}
                    </ul>
                </div>
            )}
            <div className="flex flex-col gap-2">
                <StatusText tone="destructive" className="font-medium">
                    {`${failed} ${outcome.failed.length}`}
                </StatusText>
                <ul className="flex max-h-48 flex-col divide-y overflow-y-auto rounded-lg border">
                    {outcome.failed.map((item, index) => (
                        <li key={`${index}:${item.name}`} className="flex flex-col px-3 py-2">
                            <span className="truncate font-medium">{item.name}</span>
                            <span className="text-sm text-muted-foreground">{item.error}</span>
                        </li>
                    ))}
                </ul>
            </div>
        </div>
    );
}
