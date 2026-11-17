import { IconPlus, IconTrash } from "@tabler/icons-react";
import {
    Button,
    Checkbox,
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    Field,
    FieldGroup,
    Input,
    JsonEditor,
    Label,
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
    Tabs,
    TabsList,
    TabsTrigger,
    Textarea,
    Tooltip,
    TooltipContent,
    TooltipTrigger,
    cn,
} from "obp-ui";
import { type FormEvent, useState } from "react";
import {
    EMPTY_PARAMETERS,
    NAME_LIMIT,
    PARAM_TYPES,
    type ParamRow,
    type ParamType,
    STARTERS,
    type Starter,
    nameProblem,
    parsedSchema,
    pastedTool,
    pretty,
    restFor,
    rowsOf,
    rowsProblem,
    schemaOf,
} from "~/lib/functionSchema";
import { type FunctionSpec, newId } from "~/lib/playground";

type Mode = "form" | "json";

const JSON_HINT = "A JSON schema object, or paste a whole OpenAI tool definition.";
const PASTED_NOTE = "Read as an OpenAI tool: its name, description and parameters are filled in.";

function emptyRow(): ParamRow {
    return { id: newId(), name: "", type: "string", required: false, description: "", rest: {} };
}

function start(spec: FunctionSpec | null) {
    const text = spec ? spec.parameters : pretty(EMPTY_PARAMETERS);
    const found = parsedSchema(text);
    const rows = "schema" in found ? rowsOf(found.schema) : [];
    return {
        name: spec?.name ?? "",
        description: spec?.description ?? "",
        text: "schema" in found ? pretty(found.schema) : text,
        rows: typeof rows === "string" ? [] : rows,
        blocked: typeof rows === "string" ? rows : null,
    };
}

function ParamRowEditor({
    row,
    index,
    onChange,
    onRemove,
}: {
    row: ParamRow;
    index: number;
    onChange: (next: ParamRow) => void;
    onRemove: () => void;
}) {
    const label = `Parameter ${index + 1}`;
    return (
        <div className="grid grid-cols-[9rem_7.5rem_4.5rem_minmax(0,1fr)_2rem] items-center gap-2">
            <Input
                aria-label={`${label} name`}
                value={row.name}
                className="font-mono"
                onChange={(event) => onChange({ ...row, name: event.target.value })}
            />
            <Select
                value={row.type}
                onValueChange={(next) => {
                    const type = (next as ParamType) ?? "string";
                    onChange({ ...row, type, rest: type === row.type ? row.rest : restFor(type) });
                }}
            >
                <SelectTrigger aria-label={`${label} type`} className="w-full">
                    <SelectValue />
                </SelectTrigger>
                <SelectContent>
                    {PARAM_TYPES.map((type) => (
                        <SelectItem key={type} value={type}>
                            {type}
                        </SelectItem>
                    ))}
                </SelectContent>
            </Select>
            <div className="flex justify-center">
                <Checkbox
                    aria-label={`${label} required`}
                    checked={row.required}
                    onCheckedChange={(checked) => onChange({ ...row, required: checked === true })}
                />
            </div>
            <Input
                aria-label={`${label} description`}
                value={row.description}
                placeholder="What it is, for the model"
                onChange={(event) => onChange({ ...row, description: event.target.value })}
            />
            <Tooltip>
                <TooltipTrigger asChild>
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={`Remove ${row.name.trim() || label.toLowerCase()}`}
                        onClick={onRemove}
                    >
                        <IconTrash />
                    </Button>
                </TooltipTrigger>
                <TooltipContent>Remove</TooltipContent>
            </Tooltip>
        </div>
    );
}

function ParamForm({
    rows,
    blocked,
    jsonBroken,
    onRows,
}: {
    rows: ParamRow[];
    blocked: string | null;
    jsonBroken: boolean;
    onRows: (next: ParamRow[]) => void;
}) {
    if (jsonBroken || blocked) {
        return (
            <p className="text-muted-foreground">
                {jsonBroken ? "Fix the JSON to edit the parameters here." : blocked}
            </p>
        );
    }
    return (
        <div className="flex flex-col gap-2">
            {rows.length > 0 && (
                <div className="grid grid-cols-[9rem_7.5rem_4.5rem_minmax(0,1fr)_2rem] gap-2 text-sm text-muted-foreground">
                    <span>Name</span>
                    <span>Type</span>
                    <span className="text-center">Required</span>
                    <span>Description</span>
                </div>
            )}
            {rows.length === 0 && (
                <p className="text-muted-foreground">No parameters: the model calls it bare.</p>
            )}
            {rows.map((row, index) => (
                <ParamRowEditor
                    key={row.id}
                    row={row}
                    index={index}
                    onChange={(next) =>
                        onRows(rows.map((item) => (item.id === row.id ? next : item)))
                    }
                    onRemove={() => onRows(rows.filter((item) => item.id !== row.id))}
                />
            ))}
            <Button
                type="button"
                variant="outline"
                size="sm"
                className="w-fit"
                onClick={() => onRows([...rows, emptyRow()])}
            >
                <IconPlus />
                Add parameter
            </Button>
        </div>
    );
}

function FunctionForm({
    spec,
    taken,
    onSave,
    onClose,
}: {
    spec: FunctionSpec | null;
    taken: string[];
    onSave: (next: FunctionSpec) => void;
    onClose: () => void;
}) {
    const [initial] = useState(() => start(spec));
    const [name, setName] = useState(initial.name);
    const [description, setDescription] = useState(initial.description);
    const [text, setText] = useState(initial.text);
    const [rows, setRows] = useState(initial.rows);
    const [blocked, setBlocked] = useState(initial.blocked);
    const [mode, setMode] = useState<Mode>(initial.blocked ? "json" : "form");
    const [touched, setTouched] = useState(false);
    const [note, setNote] = useState<string | null>(null);
    const parsed = parsedSchema(text);
    const jsonProblem = "problem" in parsed ? parsed.problem : null;
    const trimmed = name.trim();
    const nameIssue = nameProblem(trimmed, taken);
    const rowIssue = mode === "form" && !blocked ? rowsProblem(rows) : null;
    const problem = jsonProblem ?? rowIssue;
    const valid = !nameIssue && !problem;
    const showName = touched || name !== "" ? nameIssue : null;
    const changeRows = (next: ParamRow[]) => {
        setRows(next);
        setNote(null);
        setText(pretty(schemaOf(next, "schema" in parsed ? parsed.schema : EMPTY_PARAMETERS)));
    };
    const loadSchema = (schema: Record<string, unknown>) => {
        const found = rowsOf(schema);
        setText(pretty(schema));
        setRows(typeof found === "string" ? [] : found);
        setBlocked(typeof found === "string" ? found : null);
    };
    const changeJson = (next: string) => {
        const tool = pastedTool(next);
        if (tool) {
            if (tool.name !== null) {
                setName(tool.name);
                setTouched(true);
            }
            if (tool.description !== null) {
                setDescription(tool.description);
            }
            const found = parsedSchema(pretty(tool.parameters));
            if ("schema" in found) {
                loadSchema(found.schema);
            } else {
                setText(pretty(tool.parameters));
            }
            setNote(PASTED_NOTE);
            return;
        }
        setNote(null);
        setText(next);
        const found = parsedSchema(next);
        if ("schema" in found) {
            const shaped = rowsOf(found.schema);
            setRows(typeof shaped === "string" ? [] : shaped);
            setBlocked(typeof shaped === "string" ? shaped : null);
        }
    };
    const applyStarter = (starter: Starter) => {
        setName(starter.name);
        setDescription(starter.description);
        setTouched(true);
        setNote(null);
        loadSchema(starter.parameters);
    };
    const submit = (event: FormEvent) => {
        event.preventDefault();
        setTouched(true);
        if (valid && "schema" in parsed) {
            onSave({
                id: spec?.id ?? newId(),
                name: trimmed,
                description: description.trim(),
                parameters: pretty(parsed.schema),
            });
        }
    };
    return (
        <form onSubmit={submit} className="flex min-w-0 flex-col gap-6">
            <DialogHeader>
                <DialogTitle>{spec ? "Edit function" : "Add function"}</DialogTitle>
                <DialogDescription>
                    The model reads the name, description and parameters, and may answer with a call
                    to it.
                </DialogDescription>
            </DialogHeader>
            {!spec && (
                <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm text-muted-foreground">Start from</span>
                    {STARTERS.map((starter) => (
                        <Button
                            key={starter.label}
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => applyStarter(starter)}
                        >
                            {starter.label}
                        </Button>
                    ))}
                </div>
            )}
            <FieldGroup>
                <Field
                    id="function-name"
                    label="Name"
                    hint={
                        showName
                            ? null
                            : `Letters, digits, underscores and dashes, up to ${NAME_LIMIT}.`
                    }
                    error={showName}
                >
                    <Input
                        id="function-name"
                        value={name}
                        className="font-mono"
                        autoFocus
                        aria-invalid={showName !== null}
                        onBlur={() => setTouched(true)}
                        onChange={(event) => setName(event.target.value)}
                    />
                </Field>
                <Field id="function-description" label="Description">
                    <Textarea
                        id="function-description"
                        value={description}
                        rows={2}
                        placeholder="What it does and when to call it, for the model"
                        onChange={(event) => setDescription(event.target.value)}
                    />
                </Field>
                <Tabs
                    value={mode}
                    onValueChange={(next) => setMode(next as Mode)}
                    className="gap-label"
                >
                    <div className="flex items-center justify-between gap-3">
                        <Label id="function-parameters">Parameters</Label>
                        <TabsList aria-labelledby="function-parameters">
                            <TabsTrigger value="form" className="px-3">
                                Form
                            </TabsTrigger>
                            <TabsTrigger value="json" className="px-3">
                                JSON
                            </TabsTrigger>
                        </TabsList>
                    </div>
                    <div className="h-56 overflow-y-auto">
                        {mode === "form" ? (
                            <ParamForm
                                rows={rows}
                                blocked={blocked}
                                jsonBroken={jsonProblem !== null}
                                onRows={changeRows}
                            />
                        ) : (
                            <JsonEditor
                                aria-label="Parameters as JSON schema"
                                value={text}
                                onValueChange={changeJson}
                                minLines={10}
                                maxLines={10}
                                aria-invalid={jsonProblem !== null}
                            />
                        )}
                    </div>
                    <p
                        className={cn(
                            "min-h-lh truncate text-sm",
                            problem ? "text-destructive" : "text-muted-foreground",
                        )}
                        title={problem ?? undefined}
                    >
                        {problem ?? note ?? (mode === "json" ? JSON_HINT : null)}
                    </p>
                </Tabs>
            </FieldGroup>
            <DialogFooter>
                <Button type="button" variant="outline" onClick={onClose}>
                    Cancel
                </Button>
                <Button type="submit" disabled={!valid}>
                    {spec ? "Save" : "Add function"}
                </Button>
            </DialogFooter>
        </form>
    );
}

export function FunctionDialog({
    editing,
    taken,
    onSave,
    onClose,
}: {
    editing: FunctionSpec | "new" | null;
    taken: string[];
    onSave: (next: FunctionSpec) => void;
    onClose: () => void;
}) {
    const spec = editing === "new" ? null : editing;
    return (
        <Dialog open={editing !== null} onOpenChange={(open) => !open && onClose()}>
            <DialogContent className="sm:max-w-2xl">
                {editing !== null && (
                    <FunctionForm
                        key={spec?.id ?? "new"}
                        spec={spec}
                        taken={taken}
                        onSave={onSave}
                        onClose={onClose}
                    />
                )}
            </DialogContent>
        </Dialog>
    );
}
