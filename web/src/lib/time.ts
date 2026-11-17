const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
    ["year", 365 * 24 * 3600],
    ["month", 30 * 24 * 3600],
    ["week", 7 * 24 * 3600],
    ["day", 24 * 3600],
    ["hour", 3600],
    ["minute", 60],
];

const RELATIVE = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

export function relativeTime(value: string, now: number = Date.now()): string {
    const seconds = (new Date(value).getTime() - now) / 1000;
    for (const [unit, size] of UNITS) {
        if (Math.abs(seconds) >= size) {
            return RELATIVE.format(Math.round(seconds / size), unit);
        }
    }
    return "just now";
}

const RECENT_MS = 7 * 24 * 3600 * 1000;
const DAY_TIME: Intl.DateTimeFormatOptions = {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
};
const THIS_YEAR = new Intl.DateTimeFormat(undefined, DAY_TIME);
const OTHER_YEAR = new Intl.DateTimeFormat(undefined, { ...DAY_TIME, year: "numeric" });

export function timeText(value: string, now: number = Date.now()): string {
    const at = new Date(value);
    if (Math.abs(at.getTime() - now) < RECENT_MS) {
        return relativeTime(value, now);
    }
    const format = at.getFullYear() === new Date(now).getFullYear() ? THIS_YEAR : OTHER_YEAR;
    return format.format(at);
}

export function timeValue(value: string | null | undefined): number | undefined {
    return value ? new Date(value).getTime() : undefined;
}

export function exactTime(value: string): string {
    return new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "medium" });
}

const SHORT_DATE = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short" });
const SHORT_UNITS: [string, number][] = [
    ["w", 7 * 24 * 3600],
    ["d", 24 * 3600],
    ["h", 3600],
    ["m", 60],
];
const AGE_LIMIT_S = 5 * 7 * 24 * 3600;
const DAY_MS = 24 * 3600 * 1000;

export function ageText(value: string, now: number = Date.now()): string {
    const seconds = Math.max(0, (now - new Date(value).getTime()) / 1000);
    if (seconds >= AGE_LIMIT_S) {
        return SHORT_DATE.format(new Date(value));
    }
    for (const [unit, size] of SHORT_UNITS) {
        if (seconds >= size) {
            return `${Math.floor(seconds / size)}${unit}`;
        }
    }
    return "now";
}

export const DAY_GROUPS = ["Today", "Yesterday", "Previous 7 days", "Older"] as const;
export type DayGroup = (typeof DAY_GROUPS)[number];

function dayStart(at: Date): number {
    return new Date(at.getFullYear(), at.getMonth(), at.getDate()).getTime();
}

export function dayGroup(value: string, now: number = Date.now()): DayGroup {
    const days = Math.round((dayStart(new Date(now)) - dayStart(new Date(value))) / DAY_MS);
    if (days <= 0) {
        return "Today";
    }
    if (days === 1) {
        return "Yesterday";
    }
    return days <= 7 ? "Previous 7 days" : "Older";
}

export function fileSize(value: number | null | undefined): string {
    if (value === null || value === undefined || value >= 1024) {
        return bytes(value);
    }
    return `${value} ${value === 1 ? "byte" : "bytes"}`;
}

export function bytes(value: number | null | undefined): string {
    if (value === null || value === undefined) {
        return "–";
    }
    const gib = value / 1024 ** 3;
    if (gib >= 1) {
        return `${gib.toFixed(gib >= 10 ? 0 : 1)} GB`;
    }
    if (value >= 1024 ** 2) {
        return `${Math.round(value / 1024 ** 2)} MB`;
    }
    return value === 0 ? "0 KB" : `${Math.max(1, Math.round(value / 1024))} KB`;
}
