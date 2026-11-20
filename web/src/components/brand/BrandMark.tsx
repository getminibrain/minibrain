import { cn } from "obp-ui";
import markUrl from "./mark.svg";

export const PRODUCT_NAME = "minibrain";

export function BrandMark({
    size = 20,
    label,
    className,
}: { size?: number; label?: string; className?: string }) {
    return (
        <img
            src={markUrl}
            width={size}
            height={size}
            alt={label ?? ""}
            draggable={false}
            className={cn("shrink-0 select-none", className)}
        />
    );
}

export function BrandLockup({ size = 20 }: { size?: number }) {
    return (
        <span className="flex items-center gap-2">
            <BrandMark size={size} />
            <span className="text-base font-semibold">{PRODUCT_NAME}</span>
        </span>
    );
}
