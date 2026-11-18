import { type KeyboardEvent, type PointerEvent, useState } from "react";

const STEP = 16;

export type WidthOptions = { key: string; initial: number | null; min: number; max: number };

function clamp(width: number, { min, max }: WidthOptions): number {
    return Math.min(max, Math.max(min, Math.round(width)));
}

function read(options: WidthOptions): number | null {
    try {
        const stored = Number(window.localStorage.getItem(options.key));
        return stored ? clamp(stored, options) : options.initial;
    } catch {
        return options.initial;
    }
}

function write(key: string, width: number | null): void {
    try {
        if (width === null) {
            window.localStorage.removeItem(key);
        } else {
            window.localStorage.setItem(key, String(width));
        }
    } catch {
        return;
    }
}

export function useResizableWidth(options: WidthOptions) {
    const [width, setWidth] = useState(() => read(options));
    const commit = (next: number | null) => {
        const value = next === null ? null : clamp(next, options);
        setWidth(value);
        write(options.key, value);
    };
    const onPointerDown = (event: PointerEvent<HTMLButtonElement>) => {
        event.preventDefault();
        const startX = event.clientX;
        const panel = event.currentTarget.parentElement;
        const startWidth = panel?.getBoundingClientRect().width ?? width ?? options.min;
        const move = (moved: globalThis.PointerEvent) =>
            setWidth(clamp(startWidth + moved.clientX - startX, options));
        const stop = (ended: globalThis.PointerEvent) => {
            window.removeEventListener("pointermove", move);
            window.removeEventListener("pointerup", stop);
            commit(startWidth + ended.clientX - startX);
        };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", stop);
    };
    const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") {
            return;
        }
        event.preventDefault();
        const panel = event.currentTarget.parentElement;
        const current = panel?.getBoundingClientRect().width ?? width ?? options.min;
        commit(current + (event.key === "ArrowLeft" ? -STEP : STEP));
    };
    return { width, onPointerDown, onKeyDown, reset: () => commit(options.initial) };
}
