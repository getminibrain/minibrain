import { useRouterState } from "@tanstack/react-router";
import { useEffect } from "react";

const FLASH_MS = 1500;

export function useScrollToHash(ready: boolean) {
    const hash = useRouterState({ select: (state) => state.location.hash });
    useEffect(() => {
        if (!ready || !hash) {
            return;
        }
        const target = document.getElementById(hash.replace(/^#/, ""));
        if (target) {
            target.scrollIntoView({ block: "start" });
            target.setAttribute("data-flash", "");
            const timer = window.setTimeout(() => target.removeAttribute("data-flash"), FLASH_MS);
            return () => window.clearTimeout(timer);
        }
    }, [ready, hash]);
}
