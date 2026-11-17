export type DiffChange = "same" | "added" | "removed";

export type DiffPart = { at: number; text: string; change: DiffChange };

const WORDS = /\s+|[\p{L}\p{N}_'’]+|[^\s\p{L}\p{N}_'’]/gu;
const CELLS = 400_000;

function tokens(text: string): string[] {
    return text.match(WORDS) ?? [];
}

function suffixTable(a: string[], b: string[]): Uint32Array {
    const width = b.length + 1;
    const table = new Uint32Array((a.length + 1) * width);
    for (let i = a.length - 1; i >= 0; i--) {
        for (let j = b.length - 1; j >= 0; j--) {
            table[i * width + j] =
                a[i] === b[j]
                    ? table[(i + 1) * width + j + 1] + 1
                    : Math.max(table[(i + 1) * width + j], table[i * width + j + 1]);
        }
    }
    return table;
}

function pieces(a: string[], b: string[]): [string, DiffChange][] {
    if (a.length * b.length > CELLS) {
        return [
            [a.join(""), "removed"],
            [b.join(""), "added"],
        ];
    }
    const table = suffixTable(a, b);
    const width = b.length + 1;
    const found: [string, DiffChange][] = [];
    let i = 0;
    let j = 0;
    while (i < a.length || j < b.length) {
        if (i < a.length && j < b.length && a[i] === b[j]) {
            found.push([a[i], "same"]);
            i++;
            j++;
        } else if (
            j >= b.length ||
            (i < a.length && table[(i + 1) * width + j] >= table[i * width + j + 1])
        ) {
            found.push([a[i], "removed"]);
            i++;
        } else {
            found.push([b[j], "added"]);
            j++;
        }
    }
    return found;
}

export function wordDiff(before: string, after: string): DiffPart[] {
    const parts: DiffPart[] = [];
    let at = 0;
    for (const [text, change] of pieces(tokens(before), tokens(after))) {
        const last = parts[parts.length - 1];
        if (last && last.change === change) {
            last.text += text;
        } else {
            parts.push({ at, text, change });
        }
        at += text.length;
    }
    return parts;
}

export function differs(parts: DiffPart[]): boolean {
    return parts.some((part) => part.change !== "same");
}
