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

export function exactTime(value: string): string {
    return new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "medium" });
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
