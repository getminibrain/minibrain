import { cn, getTheme, onThemeChange } from "obp-ui";
import { useSyncExternalStore } from "react";
import { MARK_URLS, PRODUCT_NAME } from "./mark";
import { LOCKUP_MARK, LOCKUP_VIEWBOX, WORDMARK, WORDMARK_OFFSET } from "./wordmark";

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

export function BrandLockup({ large = false, className }: { large?: boolean; className?: string }) {
    const theme = useSyncExternalStore(onThemeChange, getTheme);
    return (
        <svg
            viewBox={LOCKUP_VIEWBOX}
            role="img"
            aria-label={PRODUCT_NAME}
            className={cn("w-auto shrink-0 text-foreground", large ? "h-6.5" : "h-4.5", className)}
        >
            <image
                href={MARK_URLS[theme]}
                x={LOCKUP_MARK.x}
                y={LOCKUP_MARK.y}
                width={LOCKUP_MARK.size}
                height={LOCKUP_MARK.size}
            />
            <path fill="currentColor" transform={`translate(${WORDMARK_OFFSET} 0)`} d={WORDMARK} />
        </svg>
    );
}
