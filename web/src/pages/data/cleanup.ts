import type { components } from "~/api/schema";

export type Cleanup = components["schemas"]["Cleanup"];
export type CleanupKey = keyof Cleanup;
export type Step = (table: string) => string;

export const NO_CLEANUP: Cleanup = {
    personal_data: null,
    max_tokens: null,
    conflicts: null,
    rare: null,
    per_label: null,
};

const ORDER: CleanupKey[] = ["personal_data", "max_tokens", "conflicts", "rare", "per_label"];

const TEXT = "CAST(input AS VARCHAR)";
const INPUT = `trim(${TEXT})`;
const LABEL = "trim(CAST(label AS VARCHAR))";
const USABLE = `coalesce(${INPUT}, '') <> '' AND coalesce(${LABEL}, '') <> ''`;

const PERSONAL_PATTERNS: [string, string][] = [
    ["email address", String.raw`[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}`],
    ["IBAN", String.raw`\b[A-Z]{2}\d{2}( ?[A-Z0-9]){11,30}\b`],
    ["card number", String.raw`\b\d([ -]?\d){12,18}\b`],
    [
        "phone number",
        String.raw`\+\d{1,3}[\s.-]?(\(\d{1,4}\)[\s.-]?)?\d{2,4}([\s.-]\d{2,4}){1,4}\b` +
            String.raw`|\(\d{1,4}\)[\s.-]?\d{3,4}[\s.-]\d{3,4}\b` +
            String.raw`|\b\d{3,4}[\s.-]\d{3,4}[\s.-]\d{3,4}\b`,
    ],
];

function literal(value: string): string {
    return `'${value.replaceAll("'", "''")}'`;
}

function maskedInput(): string {
    return PERSONAL_PATTERNS.reduce(
        (text, [name, pattern]) => `regexp_replace(${text}, '${pattern}', '[${name}]', 'g')`,
        TEXT,
    );
}

function personalMatch(): string {
    return PERSONAL_PATTERNS.map(([, pattern]) => `regexp_matches(${TEXT}, '${pattern}')`).join(
        " OR ",
    );
}

export function personalStep(choice: "mask" | "drop"): Step {
    if (choice === "mask") {
        return (table) => `SELECT * REPLACE (${maskedInput()} AS input) FROM ${table}`;
    }
    return (table) => `SELECT * FROM ${table} WHERE input IS NULL OR NOT (${personalMatch()})`;
}

export function longStep(tokens: number, chars: number): Step {
    return (table) =>
        `SELECT * FROM ${table} WHERE coalesce(length(${INPUT}), 0) <= ${tokens} * ${chars}`;
}

export function conflictsStep(choice: "common" | "drop"): Step {
    if (choice === "drop") {
        return (table) =>
            `SELECT * FROM ${table} QUALIFY count(DISTINCT ${LABEL}) OVER (PARTITION BY ${INPUT}) <= 1`;
    }
    return (table) =>
        `SELECT * EXCLUDE (_label_rows) FROM (SELECT *, count(*) OVER (PARTITION BY ${INPUT}, ${LABEL}) ` +
        `AS _label_rows FROM ${table}) QUALIFY dense_rank() OVER (PARTITION BY ${INPUT} ` +
        `ORDER BY coalesce(${LABEL}, '') = '', _label_rows DESC, ${LABEL}) = 1`;
}

export function rareStep(rows: number): Step {
    return (table) =>
        `SELECT * FROM ${table} QUALIFY count(*) OVER (PARTITION BY ${LABEL}) >= ${rows}`;
}

export function perLabelStep(rows: number): Step {
    return (table) =>
        `SELECT * FROM ${table} QUALIFY row_number() OVER (PARTITION BY ${LABEL} ORDER BY hash(input), input) <= ${rows}`;
}

function stepOf(key: CleanupKey, cleanup: Cleanup, chars: number): Step | null {
    const { personal_data, max_tokens, conflicts, rare, per_label } = cleanup;
    if (key === "personal_data") {
        return personal_data ? personalStep(personal_data) : null;
    }
    if (key === "max_tokens") {
        return max_tokens ? longStep(max_tokens, chars) : null;
    }
    if (key === "conflicts") {
        return conflicts ? conflictsStep(conflicts) : null;
    }
    if (key === "rare") {
        return rare ? rareStep(rare) : null;
    }
    return per_label ? perLabelStep(per_label) : null;
}

export function hasCleanup(cleanup: Cleanup): boolean {
    return ORDER.some((key) => cleanup[key] !== null && cleanup[key] !== undefined);
}

export function sameCleanup(left: Cleanup, right: Cleanup): boolean {
    return ORDER.every((key) => (left[key] ?? null) === (right[key] ?? null));
}

export function cleanedSql(sql: string, cleanup: Cleanup, chars: number): string {
    const steps = ORDER.flatMap((key) => {
        const step = stepOf(key, cleanup, chars);
        return step ? [step] : [];
    });
    if (steps.length === 0) {
        return sql;
    }
    const names = ["base", ...steps.map((_, index) => `step_${index + 1}`)];
    const parts = [
        `base AS (${sql})`,
        ...steps.map((step, index) => `${names[index + 1]} AS (${step(names[index] ?? "base")})`),
    ];
    return `WITH ${parts.join(", ")} SELECT * FROM ${names.at(-1)}`;
}

export function bareSql(sql: string): string {
    return sql.trim().replace(/;+\s*$/, "");
}

export function wrappedSql(sql: string, step: Step): string {
    return `WITH base AS (\n${bareSql(sql)}\n)\n${step("base")}`;
}

export type CheckName = "duplicates" | "conflicts" | "balance" | "length" | "personal_data";

export type Thresholds = { minLabelRows: number; longTokens: number; charsPerToken: number };

export function affectedStep(
    check: string,
    thresholds: Thresholds,
    majority: string | null,
): Step | null {
    const long = `length(${INPUT}) > ${thresholds.longTokens} * ${thresholds.charsPerToken}`;
    switch (check) {
        case "duplicates":
            return (table) =>
                `SELECT * FROM ${table} WHERE ${USABLE} QUALIFY count(*) OVER (PARTITION BY ${INPUT}) > 1 ORDER BY ${INPUT}`;
        case "conflicts":
            return (table) =>
                `SELECT * FROM ${table} WHERE ${USABLE} QUALIFY count(DISTINCT ${LABEL}) OVER (PARTITION BY ${INPUT}) > 1 ORDER BY ${INPUT}, ${LABEL}`;
        case "balance":
            return majority === null
                ? (table) =>
                      `SELECT * FROM ${table} WHERE ${USABLE} QUALIFY count(*) OVER (PARTITION BY ${LABEL}) < ${thresholds.minLabelRows} ORDER BY ${LABEL}`
                : (table) => `SELECT * FROM ${table} WHERE ${LABEL} = ${literal(majority)}`;
        case "length":
            return (table) =>
                `SELECT * FROM ${table} WHERE coalesce(${LABEL}, '') <> '' AND (coalesce(${INPUT}, '') = '' OR ${long}) ORDER BY length(${INPUT}) DESC NULLS FIRST`;
        case "personal_data":
            return (table) => `SELECT * FROM ${table} WHERE ${USABLE} AND (${personalMatch()})`;
        default:
            return null;
    }
}
