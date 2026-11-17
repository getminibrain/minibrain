import { IconDots, IconPencil, IconTrash } from "@tabler/icons-react";
import {
    Button,
    ConfirmDialog,
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
    Field,
    Input,
    SearchInput,
    Skeleton,
    cn,
    useToast,
} from "obp-ui";
import { type FormEvent, type ReactNode, useEffect, useState } from "react";
import { useChats, useDeleteChat, usePlaygroundModels, useSaveChat } from "~/api/playgroundQueries";
import { PublisherLogo } from "~/components/PublisherLogo";
import { ErrorLine } from "~/components/Section";
import type { ChatSummary, Target } from "~/lib/playground";
import { DAY_GROUPS, ageText, dayGroup, exactTime } from "~/lib/time";

const PLACEHOLDERS = ["first", "second", "third", "fourth"];

function matches(chat: ChatSummary, filter: string): boolean {
    const wanted = filter.trim().toLowerCase();
    return !wanted || `${chat.title} ${chat.model}`.toLowerCase().includes(wanted);
}

function RenameDialog({ chat, onClose }: { chat: ChatSummary | null; onClose: () => void }) {
    const save = useSaveChat();
    const [title, setTitle] = useState("");
    useEffect(() => {
        setTitle(chat?.title ?? "");
        save.reset();
    }, [chat, save.reset]);
    const submit = (event: FormEvent) => {
        event.preventDefault();
        if (chat && title.trim()) {
            save.mutate({ id: chat.id, title: title.trim() }, { onSuccess: onClose });
        }
    };
    return (
        <Dialog open={chat !== null} onOpenChange={(open) => !open && onClose()}>
            <DialogContent className="sm:max-w-md">
                <form onSubmit={submit} className="flex flex-col gap-6">
                    <DialogHeader>
                        <DialogTitle>Rename chat</DialogTitle>
                        <DialogDescription>
                            The name shows in your Recent list; only you see it.
                        </DialogDescription>
                    </DialogHeader>
                    <Field id="chat-title" label="Name">
                        <Input
                            id="chat-title"
                            value={title}
                            maxLength={120}
                            onChange={(event) => setTitle(event.target.value)}
                            autoFocus
                        />
                    </Field>
                    <ErrorLine error={save.error} />
                    <DialogFooter>
                        <Button type="button" variant="outline" onClick={onClose}>
                            Cancel
                        </Button>
                        <Button type="submit" disabled={save.isPending || !title.trim()}>
                            Rename
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}

function ChatActions({
    chat,
    onRename,
    onDelete,
}: {
    chat: ChatSummary;
    onRename: () => void;
    onDelete: () => void;
}) {
    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label={`Actions for ${chat.title}`}
                    className="opacity-0 group-focus-within/chat:opacity-100 group-hover/chat:opacity-100 data-popup-open:opacity-100"
                >
                    <IconDots aria-hidden="true" />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-40">
                <DropdownMenuItem onSelect={onRename}>
                    <IconPencil />
                    Rename
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onSelect={onDelete}>
                    <IconTrash />
                    Delete
                </DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>
    );
}

function ChatAvatar({ chat, targets }: { chat: ChatSummary; targets: Target[] }) {
    const target = targets.find((item) => item.name === chat.model);
    const key = target?.key ?? chat.model.split("@")[0];
    return (
        <PublisherLogo
            publisher={target?.publisher}
            name={target?.model_name ?? key}
            modelKey={key}
            size="sm"
        />
    );
}

function ChatRow({
    chat,
    targets,
    current,
    onOpen,
    onRename,
    onDelete,
}: {
    chat: ChatSummary;
    targets: Target[];
    current: boolean;
    onOpen: () => void;
    onRename: () => void;
    onDelete: () => void;
}) {
    return (
        <li
            className={cn(
                "group/chat relative flex h-8 items-center rounded-md",
                current ? "bg-accent text-accent-foreground" : "hover:bg-secondary",
            )}
        >
            <button
                type="button"
                onClick={onOpen}
                aria-current={current ? "true" : undefined}
                title={`${chat.title}\n${chat.model} · ${exactTime(chat.updated_at)}`}
                className="flex h-full min-w-0 flex-1 items-center gap-2 rounded-md px-2 text-left focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
                <ChatAvatar chat={chat} targets={targets} />
                <span className="min-w-0 flex-1 truncate">{chat.title}</span>
                <time
                    dateTime={chat.updated_at}
                    className="min-w-6 shrink-0 text-right text-sm text-muted-foreground tabular-nums group-focus-within/chat:opacity-0 group-hover/chat:opacity-0 group-has-data-popup-open/chat:opacity-0"
                >
                    {ageText(chat.updated_at)}
                </time>
            </button>
            <span className="absolute right-1">
                <ChatActions chat={chat} onRename={onRename} onDelete={onDelete} />
            </span>
        </li>
    );
}

function ChatGroups({
    chats,
    targets,
    current,
    onOpen,
    onRename,
    onDelete,
}: {
    chats: ChatSummary[];
    targets: Target[];
    current: number | null;
    onOpen: (id: number) => void;
    onRename: (chat: ChatSummary) => void;
    onDelete: (chat: ChatSummary) => void;
}) {
    const now = Date.now();
    const sorted = [...chats].sort((a, b) => b.updated_at.localeCompare(a.updated_at));
    return (
        <div className="flex flex-col gap-3">
            {DAY_GROUPS.map((group) => {
                const members = sorted.filter((chat) => dayGroup(chat.updated_at, now) === group);
                if (members.length === 0) {
                    return null;
                }
                const id = `recent-${group.replaceAll(" ", "-").toLowerCase()}`;
                return (
                    <section key={group} aria-labelledby={id} className="flex flex-col gap-0.5">
                        <h3 id={id} className="px-2 pb-1 text-sm text-muted-foreground">
                            {group}
                        </h3>
                        <ul className="flex flex-col gap-0.5">
                            {members.map((chat) => (
                                <ChatRow
                                    key={chat.id}
                                    chat={chat}
                                    targets={targets}
                                    current={chat.id === current}
                                    onOpen={() => onOpen(chat.id)}
                                    onRename={() => onRename(chat)}
                                    onDelete={() => onDelete(chat)}
                                />
                            ))}
                        </ul>
                    </section>
                );
            })}
        </div>
    );
}

export function Recent({
    current,
    note,
    onOpen,
    onDeleted,
    titled = true,
    action,
}: {
    current: number | null;
    note: string | null;
    onOpen: (id: number) => void;
    onDeleted: (id: number) => void;
    titled?: boolean;
    action?: ReactNode;
}) {
    const toast = useToast();
    const chats = useChats();
    const targets = usePlaygroundModels().data?.targets ?? [];
    const remove = useDeleteChat();
    const [filter, setFilter] = useState("");
    const [renaming, setRenaming] = useState<ChatSummary | null>(null);
    const [deleting, setDeleting] = useState<ChatSummary | null>(null);
    const items = chats.data ?? [];
    const shown = items.filter((chat) => matches(chat, filter));
    return (
        <div className="flex min-h-0 flex-1 flex-col">
            {(titled || action || items.length > 0 || note) && (
                <div className="flex flex-col gap-3 border-b px-4 py-3">
                    {action}
                    {titled && <h2 className="text-base font-semibold">Recent</h2>}
                    {items.length > 0 && (
                        <SearchInput
                            value={filter}
                            onValueChange={setFilter}
                            placeholder="Filter chats"
                            aria-label="Filter chats"
                        />
                    )}
                    {note && <p className="text-sm text-muted-foreground">{note}</p>}
                </div>
            )}
            <div className="min-h-0 flex-1 overflow-y-auto p-2">
                {chats.isLoading && (
                    <div className="flex flex-col gap-1 p-2">
                        {PLACEHOLDERS.map((name) => (
                            <Skeleton key={name} className="h-8 w-full" />
                        ))}
                    </div>
                )}
                {chats.data && items.length === 0 && (
                    <p className="truncate p-2 text-muted-foreground">No chats yet.</p>
                )}
                {items.length > 0 && shown.length === 0 && (
                    <p className="truncate p-2 text-muted-foreground">
                        No chat matches {filter.trim()}.
                    </p>
                )}
                {shown.length > 0 && (
                    <nav aria-label="Recent chats">
                        <ChatGroups
                            chats={shown}
                            targets={targets}
                            current={current}
                            onOpen={onOpen}
                            onRename={setRenaming}
                            onDelete={setDeleting}
                        />
                    </nav>
                )}
                <ErrorLine error={chats.error ?? remove.error} />
            </div>
            <RenameDialog chat={renaming} onClose={() => setRenaming(null)} />
            <ConfirmDialog
                open={deleting !== null}
                onOpenChange={(open) => !open && setDeleting(null)}
                title={`Delete ${deleting?.title ?? "this chat"}?`}
                description="The conversation and its settings are deleted for good."
                confirmLabel="Delete"
                destructive
                onConfirm={() =>
                    deleting &&
                    remove
                        .mutateAsync(deleting.id)
                        .then(() => {
                            onDeleted(deleting.id);
                            toast({ title: "Chat deleted", tone: "success" });
                        })
                        .catch(() => undefined)
                }
            />
        </div>
    );
}
