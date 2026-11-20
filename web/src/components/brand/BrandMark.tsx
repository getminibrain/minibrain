import { cn, getTheme, onThemeChange } from "obp-ui";
import { useSyncExternalStore } from "react";
import { MARK_URLS, PRODUCT_NAME } from "./mark";

export function BrandMark({
    size = 20,
    label,
    className,
}: { size?: number; label?: string; className?: string }) {
    const theme = useSyncExternalStore(onThemeChange, getTheme);
    return (
        <img
            src={MARK_URLS[theme]}
            width={size}
            height={size}
            alt={label ?? ""}
            draggable={false}
            className={cn("shrink-0 select-none", className)}
        />
    );
}

export function BrandLockup({ size = 20, className }: { size?: number; className?: string }) {
    return (
        <span className={cn("flex items-center gap-2", className)}>
            <BrandMark size={size} />
            <span className="text-base font-semibold">{PRODUCT_NAME}</span>
        </span>
    );
}
