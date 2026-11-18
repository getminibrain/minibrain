import { InfoTip } from "obp-ui";
import type { ReactNode } from "react";

export type Fact = [label: string, value: ReactNode, tip?: string];

export function Facts({ items }: { items: Fact[] }) {
    return (
        <dl className="grid grid-cols-[minmax(8rem,auto)_1fr] gap-x-6 gap-y-1.5">
            {items.map(([label, value, tip]) => (
                <div key={label} className="contents">
                    <dt className="flex items-start gap-1.5 text-muted-foreground">
                        {label}
                        {tip && <InfoTip label={`About ${label.toLowerCase()}`}>{tip}</InfoTip>}
                    </dt>
                    <dd className="min-w-0 break-words">{value}</dd>
                </div>
            ))}
        </dl>
    );
}
