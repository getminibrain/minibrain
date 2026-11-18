import { useEffect, useState } from "react";

function read(key: string): string[] {
    try {
        const stored = JSON.parse(window.localStorage.getItem(key) ?? "[]");
        return Array.isArray(stored) ? stored.filter((item) => typeof item === "string") : [];
    } catch {
        return [];
    }
}

export function useStoredList(key: string) {
    const [list, setList] = useState<string[]>(() => read(key));
    useEffect(() => {
        try {
            window.localStorage.setItem(key, JSON.stringify(list));
        } catch {
            return;
        }
    }, [key, list]);
    return [list, setList] as const;
}
