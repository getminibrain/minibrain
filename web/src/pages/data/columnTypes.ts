const WHOLE = /^U?(TINYINT|SMALLINT|INTEGER|BIGINT|HUGEINT)$|^INT\d*$/;
const DECIMAL = /^(FLOAT|DOUBLE|REAL|DECIMAL|NUMERIC)/;
const NESTED = /^(STRUCT|MAP|UNION)/;

export function typeWord(type: string): string {
    const name = type.trim().toUpperCase();
    if (name.endsWith("]")) {
        return "List";
    }
    if (name === "JSON" || NESTED.test(name)) {
        return "JSON";
    }
    if (name === "BOOLEAN" || name === "BOOL") {
        return "Yes/no";
    }
    if (WHOLE.test(name)) {
        return "Whole number";
    }
    if (DECIMAL.test(name)) {
        return "Number";
    }
    if (name === "DATE") {
        return "Date";
    }
    if (name.startsWith("TIMESTAMP") || name === "DATETIME") {
        return "Date and time";
    }
    if (name.startsWith("TIME")) {
        return "Time";
    }
    if (name === "INTERVAL") {
        return "Duration";
    }
    if (name === "UUID") {
        return "ID";
    }
    if (name === "BLOB") {
        return "Binary";
    }
    if (name.startsWith("VARCHAR") || name === "TEXT" || name === "STRING") {
        return "Text";
    }
    return type.toLowerCase();
}

export function isTextType(type: string): boolean {
    const word = typeWord(type);
    return word === "Text" || word === "JSON" || word === "Binary" || word === "List";
}

function cellValue(text: string | null, type: string | undefined): unknown {
    if (text === null) {
        return null;
    }
    const word = type ? typeWord(type) : "Text";
    if (word === "Whole number" || word === "Number") {
        const value = Number(text);
        const exact = word === "Number" || Number.isSafeInteger(value);
        return Number.isFinite(value) && exact ? value : text;
    }
    if (word === "Yes/no") {
        return text === "true";
    }
    if (word === "JSON" || word === "List") {
        try {
            return JSON.parse(text);
        } catch {
            return text;
        }
    }
    return text;
}

export function rowRecord(
    columns: string[],
    row: (string | null)[],
    types: Map<string, string>,
): Record<string, unknown> {
    return Object.fromEntries(
        columns.map((name, index) => [name, cellValue(row[index] ?? null, types.get(name))]),
    );
}
