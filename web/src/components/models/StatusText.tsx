import { StatusDot, cn } from "obp-ui";
import type { ReactNode } from "react";

export type Tone = "success" | "info" | "warning" | "destructive" | "neutral";

export function percentOf(fraction: number | null | undefined): number | null {
    return fraction === null || fraction === undefined ? null : fraction * 100;
}

export function StatusText({
    tone,
    active = false,
    waiting = false,
    progress = null,
    children,
    className,
}: {
    tone: Tone;
    active?: boolean;
    waiting?: boolean;
    progress?: number | null;
    children: ReactNode;
    className?: string;
}) {
    return (
        <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap", className)}>
            <StatusDot tone={tone} active={active} waiting={waiting} progress={progress} />
            {children}
        </span>
    );
}

const PULSE = {
    primary: "bg-primary/70",
    destructive: "bg-destructive/70",
};

export function ProgressBar({
    value,
    label,
    className = "w-24",
    tone = "primary",
}: {
    value: number | null | undefined;
    label: string;
    className?: string;
    tone?: keyof typeof PULSE;
}) {
    if (value === null || value === undefined) {
        return (
            <span
                aria-hidden
                className={`block h-1 overflow-hidden rounded-sm bg-secondary ${className}`}
            >
                <span
                    className={`block h-full w-1/3 animate-pulse ${PULSE[tone]} motion-reduce:animate-none`}
                />
            </span>
        );
    }
    return (
        <progress
            value={Math.round(value * 100)}
            max={100}
            aria-label={label}
            className={`block h-1 appearance-none overflow-hidden rounded-sm bg-secondary [&::-moz-progress-bar]:bg-primary [&::-webkit-progress-bar]:bg-secondary [&::-webkit-progress-value]:bg-primary ${className}`}
        />
    );
}
