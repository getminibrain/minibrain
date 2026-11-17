import { cn } from "obp-ui";
import type { FeedbackInfo } from "~/api/feedbackQueries";
import { type DiffPart, differs, wordDiff } from "~/lib/wordDiff";

export type DiffSide = "before" | "after";

const MARKS: Record<DiffSide, string> = {
    before: "rounded-sm bg-destructive-soft text-destructive line-through decoration-destructive/60",
    after: "rounded-sm bg-success-soft text-success",
};

const SHOWN: Record<DiffSide, DiffPart["change"]> = { before: "removed", after: "added" };

const cache = new WeakMap<FeedbackInfo, DiffPart[] | null>();

export function answerDiff(item: FeedbackInfo): DiffPart[] | null {
    const known = cache.get(item);
    if (known !== undefined) {
        return known;
    }
    const parts = item.output && item.suggestion ? wordDiff(item.output, item.suggestion) : null;
    const found = parts && differs(parts) ? parts : null;
    cache.set(item, found);
    return found;
}

type Run = { at: number; text: string; marked: boolean };

function runs(parts: DiffPart[], side: DiffSide): Run[] {
    const shown = SHOWN[side];
    const visible = parts.filter((part) => part.change === "same" || part.change === shown);
    const found: Run[] = [];
    visible.forEach((part, index) => {
        const bridge =
            part.text.trim() === "" &&
            visible[index - 1]?.change === shown &&
            visible[index + 1]?.change === shown;
        const marked = part.change === shown || bridge;
        const last = found[found.length - 1];
        if (last && last.marked === marked) {
            last.text += part.text;
        } else {
            found.push({ at: part.at, text: part.text, marked });
        }
    });
    return found;
}

export function DiffText({ parts, side }: { parts: DiffPart[]; side: DiffSide }) {
    return runs(parts, side).map((run) =>
        run.marked ? (
            <mark key={run.at} className={cn(MARKS[side], "px-px")}>
                {run.text}
            </mark>
        ) : (
            <span key={run.at}>{run.text}</span>
        ),
    );
}
