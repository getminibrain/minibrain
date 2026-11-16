function halfUp(value: number, digits: number): number {
    const size = Math.abs(value);
    const text = String(size);
    const shifted = text.includes("e") ? size * 10 ** digits : Number(`${text}e${digits}`);
    return (Math.sign(value) * Math.round(shifted)) / 10 ** digits;
}

export function percentNumber(value: number): number {
    return halfUp(value * 100, 1);
}

export function percent(value: number | null | undefined): string {
    return value === null || value === undefined ? "–" : `${percentNumber(value).toFixed(1)}%`;
}

export function pointsSize(delta: number): string {
    return Math.abs(percentNumber(delta)).toFixed(1);
}

export function deltaPoints(delta: number): string {
    return `${percentNumber(delta).toFixed(1)} pts`;
}

export function milliseconds(value: number | null | undefined): string {
    return value === null || value === undefined ? "–" : `${Math.round(value)} ms`;
}

export function count(value: number | null | undefined): string {
    return value === null || value === undefined ? "–" : Math.round(value).toLocaleString();
}

export function dateTime(value: string | null | undefined): string {
    return value ? new Date(value).toLocaleString() : "–";
}

export function asCode(text: string): string {
    return text ? `\`${text.replaceAll("`", "'")}\`` : "";
}

export function errorText(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
