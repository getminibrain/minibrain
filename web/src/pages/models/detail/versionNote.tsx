import { IconPencil } from "@tabler/icons-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button, Input, Tooltip, TooltipContent, TooltipTrigger, cn } from "obp-ui";
import { useState } from "react";
import { type VersionInfo, api, unwrap } from "~/api/client";
import { keys } from "~/api/queries";
import { errorMessage } from "~/components/Section";
import { useCan } from "~/lib/access";

const NOTE_LENGTH = 200;
const PLACEHOLDER = "Why this version exists, e.g. added 400 refund tickets";

function useSaveNote(slug: string, number: number) {
    const client = useQueryClient();
    return useMutation({
        mutationFn: (note: string) =>
            unwrap(
                api.PUT("/api/models/{name}/versions/{number}/note", {
                    params: { path: { name: slug, number } },
                    body: { note },
                }),
            ),
        onSuccess: (saved) => {
            client.setQueryData<VersionInfo[]>(keys.versions(slug), (old) =>
                old?.map((item) => (item.number === number ? saved : item)),
            );
            return client.invalidateQueries({ queryKey: keys.versions(slug) });
        },
    });
}

function NoteEditor({
    slug,
    version,
    onDone,
}: { slug: string; version: VersionInfo; onDone: () => void }) {
    const [text, setText] = useState(version.note ?? "");
    const save = useSaveNote(slug, version.number);
    const submit = () => {
        if (text.trim() === (version.note ?? "")) {
            onDone();
            return;
        }
        save.mutate(text, { onSuccess: onDone });
    };
    const problem = errorMessage(save.error);
    return (
        <form
            className="flex min-w-0 flex-1 items-center gap-2"
            onSubmit={(event) => {
                event.preventDefault();
                submit();
            }}
        >
            <Input
                autoFocus
                aria-label="Why this version exists"
                placeholder={PLACEHOLDER}
                maxLength={NOTE_LENGTH}
                value={text}
                readOnly={save.isPending}
                aria-invalid={Boolean(problem)}
                onChange={(event) => setText(event.target.value)}
                onKeyDown={(event) => {
                    if (event.key === "Escape") {
                        event.preventDefault();
                        onDone();
                    }
                }}
                className="h-8"
            />
            <Button type="submit" disabled={save.isPending}>
                Save
            </Button>
            <Button type="button" variant="ghost" onClick={onDone}>
                Cancel
            </Button>
            {problem && (
                <span role="alert" className="truncate text-sm text-destructive" title={problem}>
                    {problem}
                </span>
            )}
        </form>
    );
}

export function VersionNote({ slug, version }: { slug: string; version: VersionInfo }) {
    const can = useCan();
    const [editing, setEditing] = useState(false);
    const note = version.note ?? "";
    return (
        <div className="-my-1 flex h-8 min-w-0 flex-1 items-center gap-1">
            {editing ? (
                <NoteEditor slug={slug} version={version} onDone={() => setEditing(false)} />
            ) : (
                <>
                    <span
                        className={cn("min-w-0 truncate", !note && "text-muted-foreground")}
                        title={note || undefined}
                    >
                        {note || (can.build ? "Add a note on why this version exists" : "–")}
                    </span>
                    {can.build && (
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button
                                    variant="ghost"
                                    size="icon-sm"
                                    aria-label={note ? "Edit note" : "Add note"}
                                    onClick={() => setEditing(true)}
                                    className="shrink-0 text-muted-foreground hover:text-foreground"
                                >
                                    <IconPencil />
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent>{note ? "Edit note" : "Add note"}</TooltipContent>
                        </Tooltip>
                    )}
                </>
            )}
        </div>
    );
}
