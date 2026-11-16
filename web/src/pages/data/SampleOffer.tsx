import { Button, Input, Link } from "obp-ui";
import { useRef, useState } from "react";
import { ApiError } from "~/api/client";
import type { components } from "~/api/schema";
import { NewTabIcon, useNewTab } from "~/components/NewTab";
import { ErrorLine } from "~/components/Section";
import { StatusText } from "~/components/models/StatusText";
import { useCan } from "~/lib/access";
import { count } from "~/lib/format";

type Schemas = components["schemas"];
export type OverLimit = Schemas["OverLimitInfo"];
export type SampleRequest = Schemas["SampleRequest"];
export type SampleInfo = Schemas["SampleInfo"];

export function overLimitOf(error: unknown): OverLimit | null {
    if (!(error instanceof ApiError) || error.status !== 409) {
        return null;
    }
    const body = error.body as Partial<OverLimit> | null;
    return typeof body?.total_rows === "number" && typeof body.row_limit === "number"
        ? { detail: error.message, total_rows: body.total_rows, row_limit: body.row_limit }
        : null;
}

export function useOverLimit(error: unknown, sampling: boolean): OverLimit | null {
    const last = useRef<OverLimit | null>(null);
    const found = overLimitOf(error);
    if (found) {
        last.current = found;
    }
    return found ?? (sampling ? last.current : null);
}

export function sampleText(sample: SampleInfo): string {
    return `Random sample: ${count(sample.rows)} of ${count(sample.total)} rows · seed ${sample.seed}`;
}

export function SampleNote({ sample }: { sample: SampleInfo | null | undefined }) {
    if (!sample) {
        return null;
    }
    return <p className="text-muted-foreground tabular-nums">{sampleText(sample)}</p>;
}

export type SampleSubject = "query" | "file" | "source" | "sources" | "dataset";

const SUBJECT_TEXT: Record<SampleSubject, string> = {
    query: "This query returns",
    file: "This file has",
    source: "This source has",
    sources: "These sources have",
    dataset: "This dataset has",
};

function parsedRows(text: string): number {
    const digits = text.replaceAll(/[\s,_]/g, "");
    return /^\d+$/.test(digits) ? Number(digits) : Number.NaN;
}

export function SampleOffer({
    subject = "query",
    total,
    limit,
    seed,
    pending,
    error,
    onTake,
}: {
    subject?: SampleSubject;
    total: number;
    limit: number;
    seed?: number | null;
    pending: boolean;
    error?: unknown;
    onTake: (sample: SampleRequest) => void;
}) {
    const can = useCan();
    const newTab = useNewTab();
    const [typed, setTyped] = useState(String(limit));
    const rows = parsedRows(typed);
    const valid = Number.isInteger(rows) && rows >= 1 && rows <= limit;
    const take = () => {
        if (valid && !pending) {
            onTake({ rows, seed: seed ?? null });
        }
    };
    return (
        <div className="flex flex-col gap-2">
            <p>
                <StatusText tone="warning">
                    {`${SUBJECT_TEXT[subject]} ${count(total)} rows; the limit is ${count(limit)}.`}
                </StatusText>
            </p>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <Input
                    aria-label="Rows in the sample"
                    inputMode="numeric"
                    className="w-32 tabular-nums"
                    value={typed}
                    aria-invalid={valid ? undefined : true}
                    onChange={(event) => setTyped(event.target.value)}
                    onKeyDown={(event) => {
                        if (event.key === "Enter") {
                            event.preventDefault();
                            take();
                        }
                    }}
                />
                <Button type="button" disabled={!valid || pending} onClick={take}>
                    {pending
                        ? "Sampling…"
                        : `Take a random sample of ${valid ? count(rows) : "…"} rows`}
                </Button>
                {can.admin && (
                    <Link
                        href="/settings/data"
                        className="text-primary hover:underline"
                        {...newTab}
                    >
                        Change the limit
                        <NewTabIcon />
                    </Link>
                )}
            </div>
            {!valid && (
                <p className="text-sm text-destructive">{`Enter 1 to ${count(limit)} rows.`}</p>
            )}
            <ErrorLine error={error} />
        </div>
    );
}
