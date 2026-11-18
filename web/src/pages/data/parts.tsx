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
import { type WidthOptions, useResizableWidth } from "~/lib/useResizableWidth";
import { Clipped } from "../models/detail/facts";
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

function HeaderDescription({ text }: { text: string }) {
    return (
        <Tooltip>
            <TooltipTrigger asChild>
                <p className="truncate text-base">{text}</p>
            </TooltipTrigger>
            <TooltipContent className="max-w-md whitespace-pre-line">{text}</TooltipContent>
        </Tooltip>
    );
}

export function ItemHeader({
    title,
    icon,
    described,
    detail,
    actions,
}: {
    title: ReactNode;
    icon?: ReactNode;
    described?: Described;
    detail?: ReactNode;
    actions?: ReactNode;
}) {
    return (
        <header className="flex items-start justify-between gap-6">
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <h2 className="flex min-w-0 items-center gap-2 text-2xl font-semibold">
                    {icon && (
                        <span aria-hidden="true" className="shrink-0 [&>svg]:size-5">
                            {icon}
                        </span>
                    )}
                    <span className="truncate">{title}</span>
                </h2>
                {described?.description && <HeaderDescription text={described.description} />}
                {described && described.tags.length > 0 && (
                    <div className="py-1">
                        <Tags tags={described.tags} />
                    </div>
                )}
                {detail && <p className="text-muted-foreground">{detail}</p>}
            </div>
            {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </header>
    );
}

export type SplitSide = {
    label: string;
    sizing: WidthOptions;
    widths: string;
    className: string;
};

const ABOUT_SIDE: SplitSide = {
    label: "About",
    sizing: { key: "minibrain.data.aboutWidth", initial: null, min: 280, max: 640 },
    widths: "@3xl/data:w-80 @min-[54rem]/detail:w-90 @6xl/detail:w-100",
    className: "gap-10",
};

export function SplitDetail({
    header,
    about,
    preview,
    side = ABOUT_SIDE,
}: {
    header: ReactNode;
    about: ReactNode;
    preview: ReactNode;
    side?: SplitSide;
}) {
    const width = useResizableWidth(side.sizing);
    return (
        <div className="@container/detail flex min-h-0 min-w-0 flex-1 flex-col">
            <div className="shrink-0 border-b px-6 py-5">{header}</div>
            <div className="flex min-h-0 flex-1 flex-col @3xl/data:flex-row">
                <div
                    className={cn(
                        "relative flex shrink-0 flex-col border-b @3xl/data:border-r @3xl/data:border-b-0",
                        width.width === null && side.widths,
                    )}
                    style={width.width === null ? undefined : { width: width.width }}
                >
                    <section
                        aria-label={side.label}
                        className={cn(
                            "flex min-h-0 flex-1 flex-col p-6 @3xl/data:overflow-y-auto",
                            side.className,
                        )}
                    >
                        {about}
                    </section>
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <button
                                type="button"
                                aria-label={`Resize ${side.label}`}
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
            <div className="flex min-w-0 flex-col gap-2 pl-3">{children}</div>
        </section>
    );
}

export function PartAction({
    label,
    onClick,
    children,
}: {
    label: string;
    onClick: () => void;
    children: ReactNode;
}) {
    return (
        <Tooltip>
            <TooltipTrigger asChild>
                <Button variant="ghost" size="icon-sm" aria-label={label} onClick={onClick}>
                    {children}
                </Button>
            </TooltipTrigger>
            <TooltipContent>{label}</TooltipContent>
        </Tooltip>
    );
}

export function Facts({ children }: { children: ReactNode }) {
    return (
        <dl className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-x-3 gap-y-1.5 tabular-nums">
            {children}
        </dl>
    );
}

export function Fact({ label, value }: { label: string; value: ReactNode }) {
    return (
        <>
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="min-w-0 truncate">{value}</dd>
        </>
    );
}

export function Stats({ children }: { children: ReactNode }) {
    return <div className="grid grid-cols-3 gap-x-4 gap-y-3">{children}</div>;
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

function percent(share: number): string {
    return `${(share * 100).toFixed(share < 0.1 ? 1 : 0)}%`;
}

function sizeText(rows: number, total: number): string {
    return `${rows.toLocaleString()} · ${percent(rows / total)}`;
}

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
    const sizes = shown.map((item) => sizeText(item.rows, total));
    const widest = Math.max(...sizes.map((text) => text.length), 1);
    return (
        <div className="flex flex-col gap-1">
            <table className="w-full table-fixed border-collapse">
                <caption className="sr-only">Rows per label</caption>
                <colgroup>
                    <col />
                    <col style={{ width: `${widest + 2}ch` }} />
                </colgroup>
                <thead className="sr-only">
                    <tr>
                        <th scope="col">Label</th>
                        <th scope="col">Rows and share</th>
                    </tr>
                </thead>
                <tbody>
                    {shown.map((item, index) => (
                        <tr key={item.label} className="group/bar hover:bg-secondary">
                            <th scope="row" className="py-1 pr-3 text-left font-normal">
                                <Clipped text={item.label} className="block" />
                                <div
                                    aria-hidden="true"
                                    className="mt-1 h-1.5 rounded-r-sm bg-primary"
                                    style={{ width: `${(item.rows / largest) * 100}%` }}
                                />
                            </th>
                            <td className="py-1 text-right align-top text-sm whitespace-nowrap text-muted-foreground tabular-nums group-hover/bar:text-foreground">
                                {sizes[index]}
                            </td>
                        </tr>
                    ))}
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
