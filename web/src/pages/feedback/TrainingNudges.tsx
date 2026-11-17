import { IconSchool } from "@tabler/icons-react";
import { Button, Link } from "obp-ui";
import { type UntrainedFeedback, useUntrainedFeedback } from "~/api/feedbackQueries";
import { count } from "~/lib/format";
import { trainHref } from "~/lib/modelLinks";

function nudgeText(row: UntrainedFeedback): string {
    const answers = `${count(row.accepted)} accepted ${row.accepted === 1 ? "answer" : "answers"}`;
    return `${row.model_name}: ${answers}${row.version === null ? "" : ` since v${row.version}`}`;
}

export function TrainingNudges({ models }: { models: string[] }) {
    const untrained = useUntrainedFeedback();
    const rows = (untrained.data ?? []).filter(
        (row) => models.length === 0 || models.includes(row.model),
    );
    if (rows.length === 0) {
        return null;
    }
    return (
        <ul className="flex flex-col divide-y rounded-md border bg-card">
            {rows.map((row) => (
                <li key={row.model} className="flex min-h-11 items-center gap-3 px-3 py-1.5">
                    <IconSchool
                        aria-hidden="true"
                        className="size-4 shrink-0 text-muted-foreground"
                    />
                    <span className="min-w-0 flex-1 truncate tabular-nums">{nudgeText(row)}</span>
                    <Button asChild variant="outline">
                        <Link href={trainHref(row.model)}>{`Train v${row.next_version}`}</Link>
                    </Button>
                </li>
            ))}
        </ul>
    );
}
