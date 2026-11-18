import { IconDots, IconTrash } from "@tabler/icons-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
    Button,
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
    FieldGroup,
    InfoTip,
    Input,
    Textarea,
    Tooltip,
    TooltipContent,
    TooltipTrigger,
    cn,
} from "obp-ui";
import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import type { LabelCount } from "~/api/client";
import { dataKeys } from "~/api/dataQueries";
import { keys, useAllModels, useSources } from "~/api/queries";
import { ErrorLine } from "~/components/Section";
import { TAGS_HINT, Tags, editableTags } from "~/components/Tags";
import { modelPageHref } from "~/lib/modelLinks";
import { useResizableWidth } from "~/lib/useResizableWidth";
import { splitTags } from "../models/dialogs";
import { sourceNameProblem } from "./catalogue";

export const FILL = "flex min-h-0 flex-1 flex-col";

export const FILL_GRID = "min-h-64 flex-1";

export type Described = { name: string; description: string; tags: string[] };

export function useDataRefresh() {
    const client = useQueryClient();
    return () =>
        Promise.all([
            client.invalidateQueries({ queryKey: keys.datasets }),
            client.invalidateQueries({ queryKey: keys.sources }),
            client.invalidateQueries({ queryKey: dataKeys.datasetFolders }),
            client.invalidateQueries({ queryKey: keys.allModels }),
            client.invalidateQueries({ queryKey: ["model"] }),
        ]);
}

export function useSourceNameProblem(name: string, except?: number): string | null {
    const sources = useSources();
    return sourceNameProblem(sources.data ?? [], name, except);
}

export function useModelNames() {
    const models = useAllModels();
    const names = new Map((models.data ?? []).map((row) => [row.key, row.name]));
    return (slug: string) => names.get(slug) ?? slug;
}

export function modelHref(slug: string): string {
    return modelPageHref(slug);
}

export function ItemHeader({
    title,
    icon,
    detail,
    actions,
}: {
    title: ReactNode;
    icon?: ReactNode;
    detail?: ReactNode;
    actions?: ReactNode;
}) {
    return (
        <header className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex min-w-0 flex-col gap-0.5">
                <h2 className="flex min-w-0 items-center gap-2 text-2xl font-semibold">
                    {icon && (
                        <span aria-hidden="true" className="shrink-0 [&>svg]:size-5">
                            {icon}
                        </span>
                    )}
                    <span className="truncate">{title}</span>
                </h2>
                {detail && <p className="text-muted-foreground">{detail}</p>}
            </div>
            {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </header>
    );
}

const ABOUT_WIDTH = { key: "minibrain.data.aboutWidth", initial: null, min: 280, max: 640 };

export function SplitDetail({
    header,
    about,
    preview,
}: {
    header: ReactNode;
    about: ReactNode;
    preview: ReactNode;
}) {
    const width = useResizableWidth(ABOUT_WIDTH);
    return (
        <div className="@container/detail flex min-h-0 min-w-0 flex-1 flex-col">
            <div className="shrink-0 border-b px-6 py-5">{header}</div>
            <div className="flex min-h-0 flex-1 flex-col @3xl/data:flex-row">
                <div
                    className={cn(
                        "relative flex shrink-0 flex-col border-b @3xl/data:border-r @3xl/data:border-b-0",
                        width.width === null &&
                            "@3xl/data:w-80 @min-[54rem]/detail:w-90 @6xl/detail:w-100",
                    )}
                    style={width.width === null ? undefined : { width: width.width }}
                >
                    <section
                        aria-label="About"
                        className="flex min-h-0 flex-1 flex-col gap-10 p-6 @3xl/data:overflow-y-auto"
                    >
                        {about}
                    </section>
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <button
                                type="button"
                                aria-label="Resize About"
                                onPointerDown={width.onPointerDown}
                                onKeyDown={width.onKeyDown}
                                onDoubleClick={width.reset}
                                className="absolute inset-y-0 -right-1 z-10 hidden w-2 cursor-col-resize touch-none outline-none select-none after:absolute after:inset-y-0 after:left-1/2 after:w-0.5 after:-translate-x-1/2 hover:after:bg-primary focus-visible:after:bg-primary @3xl/data:block"
                            />
                        </TooltipTrigger>
                        <TooltipContent side="right">
                            Drag to resize, double-click to reset
                        </TooltipContent>
                    </Tooltip>
                </div>
                {preview}
            </div>
        </div>
    );
}

export function AboutPart({
    title,
    tip,
    action,
    children,
}: {
    title: string;
    tip?: ReactNode;
    action?: ReactNode;
    children: ReactNode;
}) {
    return (
        <section className="flex min-w-0 flex-col gap-2">
            <div className="flex min-h-8 items-center justify-between gap-2">
                <h3 className="flex items-center gap-1.5 font-semibold">
                    {title}
                    {tip && (
                        <InfoTip label={`About ${title.toLowerCase()}`} side="right">
                            {tip}
                        </InfoTip>
                    )}
                </h3>
                {action}
            </div>
            {children}
        </section>
    );
}

export function Stats({ children }: { children: ReactNode }) {
    return <div className="grid grid-cols-3 gap-x-4 gap-y-3">{children}</div>;
}

export function Description({ item, onEdit }: { item: Described; onEdit: () => void }) {
    if (!item.description && item.tags.length === 0) {
        return (
            <div>
                <Button variant="link" className="h-auto px-0" onClick={onEdit}>
                    Add a description and tags
                </Button>
            </div>
        );
    }
    return (
        <div className="flex flex-col gap-2">
            {item.description && (
                <p className="text-base break-words whitespace-pre-line">{item.description}</p>
            )}
            <Tags tags={item.tags} />
        </div>
    );
}

export type EditFocus = "name" | "description";

export function EditDialog({
    item,
    focus,
    noun,
    problem,
    onFocusChange,
    onSave,
}: {
    item: Described;
    focus: EditFocus | null;
    noun: string;
    problem: (name: string) => string | null;
    onFocusChange: (focus: EditFocus | null) => void;
    onSave: (body: Described) => Promise<unknown>;
}) {
    const open = focus !== null;
    const onOpenChange = (next: boolean) => !next && onFocusChange(null);
    const nameField = useRef<HTMLInputElement>(null);
    const descriptionField = useRef<HTMLTextAreaElement>(null);
    const [name, setName] = useState(item.name);
    const [description, setDescription] = useState(item.description);
    const [tags, setTags] = useState(editableTags(item.tags));
    useEffect(() => {
        if (open) {
            setName(item.name);
            setDescription(item.description);
            setTags(editableTags(item.tags));
        }
    }, [open, item]);
    const save = useMutation({
        mutationFn: () =>
            onSave({ name: name.trim(), description: description.trim(), tags: splitTags(tags) }),
        onSuccess: () => onOpenChange(false),
    });
    const clash = name.trim() ? problem(name) : null;
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent
                className="sm:max-w-lg"
                initialFocus={focus === "description" ? descriptionField : nameField}
            >
                <form
                    onSubmit={(event) => {
                        event.preventDefault();
                        if (!clash) {
                            save.mutate();
                        }
                    }}
                    className="contents"
                >
                    <DialogHeader>
                        <DialogTitle>{`Edit ${noun}`}</DialogTitle>
                        <DialogDescription>
                            Name, description and tags help people find it in search.
                        </DialogDescription>
                    </DialogHeader>
                    <FieldGroup>
                        <Field id="data-edit-name" label="Name" error={clash}>
                            <Input
                                ref={nameField}
                                id="data-edit-name"
                                value={name}
                                maxLength={120}
                                aria-invalid={clash ? true : undefined}
                                onChange={(event) => setName(event.target.value)}
                            />
                        </Field>
                        <Field id="data-edit-description" label="Description">
                            <Textarea
                                ref={descriptionField}
                                id="data-edit-description"
                                value={description}
                                maxLength={1000}
                                rows={3}
                                onChange={(event) => setDescription(event.target.value)}
                            />
                        </Field>
                        <Field id="data-edit-tags" label="Tags" hint={TAGS_HINT}>
                            <Input
                                id="data-edit-tags"
                                value={tags}
                                onChange={(event) => setTags(event.target.value)}
                            />
                        </Field>
                    </FieldGroup>
                    <ErrorLine error={save.error} />
                    <DialogFooter>
                        <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                            Cancel
                        </Button>
                        <Button type="submit" disabled={!name.trim() || !!clash || save.isPending}>
                            Save
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}

export function ItemMenu({ name, children }: { name: string; children: ReactNode }) {
    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon" aria-label={`More actions for ${name}`}>
                    <IconDots />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64">
                {children}
            </DropdownMenuContent>
        </DropdownMenu>
    );
}

export function DeleteMenuItem({
    blocked,
    onSelect,
}: {
    blocked: string | null;
    onSelect: () => void;
}) {
    const reason = useId();
    return (
        <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
                variant="destructive"
                disabled={blocked !== null}
                aria-describedby={blocked ? reason : undefined}
                onSelect={onSelect}
            >
                <IconTrash />
                Delete
            </DropdownMenuItem>
            {blocked && (
                <p id={reason} className="pr-2.5 pb-1.5 pl-9 text-sm text-muted-foreground">
                    {blocked}
                </p>
            )}
        </>
    );
}

const SHOWN_LABELS = 10;

export function LabelBalance({
    counts,
    labels,
    rows,
}: {
    counts: LabelCount[];
    labels: number;
    rows: number;
}) {
    const [all, setAll] = useState(false);
    const total = Math.max(
        rows,
        counts.reduce((sum, item) => sum + item.rows, 0),
    );
    const largest = counts[0]?.rows ?? 0;
    const shown = all ? counts : counts.slice(0, SHOWN_LABELS);
    const hidden = counts.length - shown.length;
    if (total === 0) {
        return <p className="text-muted-foreground">No labelled rows yet.</p>;
    }
    return (
        <div className="flex flex-col gap-1">
            <table className="w-full table-fixed border-collapse">
                <caption className="sr-only">Rows per label</caption>
                <thead className="sr-only">
                    <tr>
                        <th scope="col">Label</th>
                        <th scope="col">Share</th>
                        <th scope="col">Rows</th>
                    </tr>
                </thead>
                <tbody>
                    {shown.map((item) => {
                        const share = item.rows / total;
                        return (
                            <tr key={item.label} className="group/bar h-7 hover:bg-secondary">
                                <th scope="row" className="w-[40%] pr-2 text-left font-normal">
                                    <Tooltip>
                                        <TooltipTrigger asChild>
                                            <span className="block truncate">{item.label}</span>
                                        </TooltipTrigger>
                                        <TooltipContent className="max-w-96 break-all">
                                            {`${item.label}: ${item.rows.toLocaleString()} rows, ${(share * 100).toFixed(1)}%`}
                                        </TooltipContent>
                                    </Tooltip>
                                </th>
                                <td className="pr-2">
                                    <div
                                        aria-hidden="true"
                                        className="h-3 rounded-r-sm bg-primary"
                                        style={{ width: `${(item.rows / largest) * 100}%` }}
                                    />
                                    <span className="sr-only">{`${(share * 100).toFixed(1)}%`}</span>
                                </td>
                                <td className="w-16 text-right text-sm text-muted-foreground tabular-nums group-hover/bar:text-foreground">
                                    {item.rows.toLocaleString()}
                                </td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
            {(hidden > 0 || all) && counts.length > SHOWN_LABELS && (
                <div>
                    <Button variant="link" className="h-auto px-0" onClick={() => setAll(!all)}>
                        {all
                            ? "Show the top 10"
                            : labels > counts.length
                              ? `Show the top ${counts.length.toLocaleString()} of ${labels.toLocaleString()} labels`
                              : `Show all ${counts.length.toLocaleString()} labels`}
                    </Button>
                </div>
            )}
        </div>
    );
}
