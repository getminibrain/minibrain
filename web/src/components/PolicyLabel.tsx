import { InfoTip } from "obp-ui";

export function PolicyLabel({ policy }: { policy: { label: string; detail?: string } }) {
    if (!policy.detail) {
        return <>{policy.label}</>;
    }
    return (
        <span className="inline-flex items-center gap-1.5">
            {policy.label}
            <InfoTip label={`About ${policy.label.toLowerCase()}`} className="relative z-20">
                {policy.detail}
            </InfoTip>
        </span>
    );
}
