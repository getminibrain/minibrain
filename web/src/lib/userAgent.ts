const BROWSERS: [RegExp, string][] = [
    [/Edg\//, "Edge"],
    [/OPR\/|Opera/, "Opera"],
    [/Firefox\/|FxiOS/, "Firefox"],
    [/Chrome\/|CriOS/, "Chrome"],
    [/Safari\//, "Safari"],
];

const SYSTEMS: [RegExp, string][] = [
    [/iPhone|iPad|iPod/, "iOS"],
    [/Android/, "Android"],
    [/CrOS/, "ChromeOS"],
    [/Macintosh|Mac OS X/, "macOS"],
    [/Windows/, "Windows"],
    [/Linux/, "Linux"],
];

const UNKNOWN = "Unknown device";

function firstMatch(table: [RegExp, string][], agent: string): string | undefined {
    return table.find(([pattern]) => pattern.test(agent))?.[1];
}

export function deviceName(agent: string | null | undefined): string {
    if (!agent) {
        return UNKNOWN;
    }
    const browser = firstMatch(BROWSERS, agent);
    const system = firstMatch(SYSTEMS, agent);
    if (browser && system) {
        return `${browser} on ${system}`;
    }
    return browser ?? system ?? (agent.split(/[\s/]/)[0] || UNKNOWN);
}
