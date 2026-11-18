import { IconRotateClockwise } from "@tabler/icons-react";
import { Button, cn } from "obp-ui";
import { useState } from "react";

export function useRetry(retry: () => unknown): { pending: boolean; run: () => void } {
    const [pending, setPending] = useState(false);
    const run = () => {
        setPending(true);
        void Promise.resolve(retry()).finally(() => setPending(false));
    };
    return { pending, run };
}

export function RetryButton({
    retry,
    label = "Try again",
    primary = true,
    size,
}: {
    retry: () => unknown;
    label?: string;
    primary?: boolean;
    size?: "sm";
}) {
    const { pending, run } = useRetry(retry);
    return (
        <Button
            variant={primary ? "default" : "outline"}
            size={size}
            disabled={pending}
            aria-busy={pending}
            onClick={run}
        >
            <IconRotateClockwise
                aria-hidden="true"
                className={cn(pending && "animate-spin motion-reduce:animate-none")}
            />
            {label}
        </Button>
    );
}
