import { IconPencil, IconPlus, IconTrash, IconX } from "@tabler/icons-react";
import {
    Button,
    Collapsible,
    CollapsibleContent,
    CollapsibleTrigger,
    InfoTip,
    Input,
    JsonEditor,
    Label,
    OptionalNumberField,
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
    Tooltip,
    TooltipContent,
    TooltipTrigger,
} from "obp-ui";
import { type ReactNode, useState } from "react";
import { signature } from "~/lib/functionSchema";
import {
    type FunctionSpec,
    type ResponseFormat,
    type Settings,
    type Target,
    jsonProblem,
    reasoningOptions,
} from "~/lib/playground";
import { FunctionDialog } from "./FunctionDialog";
import { Presets } from "./Presets";

const MODEL_DEFAULT = "default";
const MAX_STOPS = 4;
const TOKEN_CAP = 32768;
const WHOLE = { maximumFractionDigits: 0 };
const TWO = { maximumFractionDigits: 2 };

type Change = (next: Partial<Settings>) => void;

function Group({
    title,
    children,
    open = true,
}: { title: string; children: ReactNode; open?: boolean }) {
    return (
        <Collapsible defaultOpen={open} className="border-b px-4 py-3 last:border-b-0">
            <CollapsibleTrigger className="w-full font-medium">{title}</CollapsibleTrigger>
            <CollapsibleContent>
                <div className="flex flex-col gap-4 pt-3">{children}</div>
            </CollapsibleContent>
        </Collapsible>
    );
}

function Labelled({
    id,
    label,
    help,
    children,
}: { id: string | null; label: string; help: ReactNode; children: ReactNode }) {
    return (
        <div className="flex flex-col gap-label">
            <div className="flex items-center gap-1.5">
                {id ? (
                    <Label htmlFor={id}>{label}</Label>
                ) : (
                    <span className="leading-snug font-medium">{label}</span>
                )}
                <InfoTip label={`About ${label}`}>{help}</InfoTip>
            </div>
            {children}
        </div>
    );
}

function Note({ children }: { children: ReactNode }) {
    return <p className="text-sm text-muted-foreground">{children}</p>;
}

function ReasoningControl({
    target,
    settings,
    onChange,
}: { target: Target | undefined; settings: Settings; onChange: Change }) {
    const options = reasoningOptions(target);
    const fixed = target?.reasoning === "always";
    const explain = !target
        ? null
        : target.contract !== "text"
          ? "This model answers with its contract, so it does not reason."
          : fixed
            ? "This model always reasons; it has no setting."
            : options.length === 0
              ? "This model does not reason."
              : null;
    return (
        <Labelled
            id="playground-reasoning"
            label="Reasoning"
            help="Whether the model thinks before it answers, and how hard, where its family supports it: Qwen3 thinks or not, gpt-oss takes an effort. The reasoning shows apart from the answer. Model default leaves it to the model."
        >
            <Select
                value={settings.reasoning ?? MODEL_DEFAULT}
                disabled={options.length === 0}
                onValueChange={(next) =>
                    onChange({ reasoning: !next || next === MODEL_DEFAULT ? null : String(next) })
                }
            >
                <SelectTrigger id="playground-reasoning" className="w-full">
                    <SelectValue />
                </SelectTrigger>
                <SelectContent>
                    <SelectItem value={MODEL_DEFAULT}>
                        {fixed ? "Always on" : "Model default"}
                    </SelectItem>
                    {options.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                            {option.label}
                        </SelectItem>
                    ))}
                </SelectContent>
            </Select>
            {explain && <Note>{explain}</Note>}
        </Labelled>
    );
}

function contractNote(target: Target | undefined): string | null {
    if (target?.contract === "labels") {
        return "This model answers with one of its labels, its contract; formats and functions do not apply.";
    }
    if (target?.contract === "json") {
        return "This model answers with its own JSON schema, its contract; formats and functions do not apply.";
    }
    return null;
}

function FormatControl({
    target,
    settings,
    onChange,
}: { target: Target | undefined; settings: Settings; onChange: Change }) {
    const locked = target !== undefined && target.contract !== "text";
    const problem =
        settings.response_format === "json_schema" ? jsonProblem(settings.schema) : null;
    return (
        <Labelled
            id="playground-format"
            label="Response format"
            help="Text leaves the answer free. JSON object makes it a JSON object; JSON schema holds it to your schema. SGLang and llama.cpp constrain while generating; other engines check the answer after, and a mismatch is an error."
        >
            <Select
                value={settings.response_format}
                disabled={locked}
                onValueChange={(next) =>
                    onChange({ response_format: (next as ResponseFormat) ?? "text" })
                }
            >
                <SelectTrigger id="playground-format" className="w-full">
                    <SelectValue />
                </SelectTrigger>
                <SelectContent>
                    <SelectItem value="text">Text</SelectItem>
                    <SelectItem value="json_object">JSON object</SelectItem>
                    <SelectItem value="json_schema">JSON schema</SelectItem>
                </SelectContent>
            </Select>
            {settings.response_format === "json_schema" && !locked && (
                <>
                    <Input
                        aria-label="Schema name"
                        value={settings.schema_name}
                        onChange={(event) => onChange({ schema_name: event.target.value })}
                        placeholder="Schema name"
                    />
                    <JsonEditor
                        aria-label="JSON schema"
                        value={settings.schema}
                        onValueChange={(schema) => onChange({ schema })}
                        minLines={6}
                        maxLines={16}
                        aria-invalid={problem !== null}
                    />
                    {problem && <p className="text-sm text-destructive">{problem}</p>}
                </>
            )}
        </Labelled>
    );
}

function FunctionLine({
    spec,
    onEdit,
    onRemove,
}: {
    spec: FunctionSpec;
    onEdit: () => void;
    onRemove: () => void;
}) {
    const shown = signature(spec.name, spec.parameters);
    return (
        <li className="flex h-8 items-center gap-1 rounded-md border pr-0.5 pl-2.5">
            <span className="min-w-0 flex-1 truncate font-mono" title={shown}>
                {shown}
            </span>
            <Tooltip>
                <TooltipTrigger asChild>
                    <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Edit ${spec.name}`}
                        onClick={onEdit}
                    >
                        <IconPencil />
                    </Button>
                </TooltipTrigger>
                <TooltipContent>Edit</TooltipContent>
            </Tooltip>
            <Tooltip>
                <TooltipTrigger asChild>
                    <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Delete ${spec.name}`}
                        onClick={onRemove}
                    >
                        <IconTrash />
                    </Button>
                </TooltipTrigger>
                <TooltipContent>Delete</TooltipContent>
            </Tooltip>
        </li>
    );
}

function FunctionsControl({
    target,
    settings,
    onChange,
}: { target: Target | undefined; settings: Settings; onChange: Change }) {
    const [editing, setEditing] = useState<FunctionSpec | "new" | null>(null);
    const unsupported = target !== undefined && target.contract === "text" && !target.tools;
    const locked = target !== undefined && (target.contract !== "text" || !target.tools);
    const update = (functions: FunctionSpec[], wanted = settings.tool_choice) => {
        const names = new Set(functions.map((item) => item.name));
        const kept = ["auto", "none", "required"].includes(wanted) || names.has(wanted);
        onChange({ functions, tool_choice: kept ? wanted : "auto" });
    };
    const save = (next: FunctionSpec) => {
        const before = settings.functions.find((item) => item.id === next.id);
        const functions = before
            ? settings.functions.map((item) => (item.id === next.id ? next : item))
            : [...settings.functions, next];
        update(functions, before?.name === settings.tool_choice ? next.name : settings.tool_choice);
        setEditing(null);
    };
    const editingId = editing !== null && editing !== "new" ? editing.id : null;
    const taken = settings.functions
        .filter((item) => item.id !== editingId)
        .map((item) => item.name);
    return (
        <Labelled
            id={null}
            label="Functions"
            help="Tools the model may call. It answers with a call and its arguments; paste the result into the chat to let it continue. Each family's chat template renders them (Qwen, Llama 3.1 and later, Mistral, gpt-oss)."
        >
            {unsupported && (
                <Note>This base has no tool-call format minibrain reads in its chat template.</Note>
            )}
            {!locked && settings.functions.length > 0 && (
                <ul className="flex flex-col gap-1.5" aria-label="Functions">
                    {settings.functions.map((spec) => (
                        <FunctionLine
                            key={spec.id}
                            spec={spec}
                            onEdit={() => setEditing(spec)}
                            onRemove={() =>
                                update(settings.functions.filter((item) => item.id !== spec.id))
                            }
                        />
                    ))}
                </ul>
            )}
            <Button
                variant="outline"
                size="sm"
                className="w-fit"
                disabled={locked}
                onClick={() => setEditing("new")}
            >
                <IconPlus />
                Add function
            </Button>
            {!locked && settings.functions.length > 0 && (
                <div className="flex items-center justify-between gap-3">
                    <Label htmlFor="playground-tool-choice">Tool choice</Label>
                    <Select
                        value={settings.tool_choice}
                        onValueChange={(next) => onChange({ tool_choice: String(next ?? "auto") })}
                    >
                        <SelectTrigger id="playground-tool-choice" className="w-40">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="auto">Auto</SelectItem>
                            <SelectItem value="none">None</SelectItem>
                            <SelectItem value="required">Required</SelectItem>
                            {settings.functions.map((spec) => (
                                <SelectItem key={spec.id} value={spec.name}>
                                    <span className="font-mono">{spec.name}</span>
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>
            )}
            <FunctionDialog
                editing={editing}
                taken={taken}
                onSave={save}
                onClose={() => setEditing(null)}
            />
        </Labelled>
    );
}

function StopControl({ settings, onChange }: { settings: Settings; onChange: Change }) {
    const [draft, setDraft] = useState("");
    const add = () => {
        if (draft && settings.stop.length < MAX_STOPS && !settings.stop.includes(draft)) {
            onChange({ stop: [...settings.stop, draft] });
            setDraft("");
        }
    };
    return (
        <Labelled
            id="playground-stop"
            label="Stop sequences"
            help={`Up to ${MAX_STOPS} texts that end the answer when the model writes them; they are not returned. Unset: the model's own stop tokens only.`}
        >
            <div className="flex gap-2">
                <Input
                    id="playground-stop"
                    value={draft}
                    placeholder={settings.stop.length ? "Add another" : "Unset"}
                    disabled={settings.stop.length >= MAX_STOPS}
                    onChange={(event) => setDraft(event.target.value)}
                    onKeyDown={(event) => {
                        if (event.key === "Enter") {
                            event.preventDefault();
                            add();
                        }
                    }}
                />
                <Button
                    variant="outline"
                    onClick={add}
                    disabled={!draft || settings.stop.length >= MAX_STOPS}
                >
                    Add
                </Button>
            </div>
            {settings.stop.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                    {settings.stop.map((text) => (
                        <span
                            key={text}
                            className="inline-flex items-center gap-1 rounded-md border px-2 py-0.5 font-mono text-sm"
                        >
                            {JSON.stringify(text)}
                            <button
                                type="button"
                                aria-label={`Remove stop ${text}`}
                                className="rounded-sm text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                                onClick={() =>
                                    onChange({
                                        stop: settings.stop.filter((item) => item !== text),
                                    })
                                }
                            >
                                <IconX className="size-3.5" aria-hidden="true" />
                            </button>
                        </span>
                    ))}
                </div>
            )}
        </Labelled>
    );
}

export function SettingsPanel({
    target,
    settings,
    onSettings,
    preset,
    onPreset,
}: {
    target: Target | undefined;
    settings: Settings;
    onSettings: (next: Settings) => void;
    preset: number | null;
    onPreset: (id: number | null) => void;
}) {
    const change: Change = (next) => onSettings({ ...settings, ...next });
    const note = contractNote(target);
    const limit = target?.context_tokens ?? TOKEN_CAP;
    return (
        <div className="flex flex-col">
            {note && (
                <div className="border-b px-4 py-3">
                    <Note>{note}</Note>
                </div>
            )}
            <Group title="Presets">
                <Presets
                    settings={settings}
                    onLoad={onSettings}
                    chosen={preset}
                    onChosen={onPreset}
                />
            </Group>
            <Group title="Settings">
                <OptionalNumberField
                    id="playground-max-tokens"
                    label="Max tokens"
                    help={`The most tokens the answer may use. Unset means the model's limit${target?.context_tokens ? `, ${target.context_tokens.toLocaleString()} tokens of context for this one` : ""}.`}
                    value={settings.max_tokens}
                    onValueChange={(max_tokens) => change({ max_tokens })}
                    min={1}
                    max={limit}
                    step={1}
                    largeStep={256}
                    fallback={Math.min(1024, limit)}
                    format={WHOLE}
                />
                <OptionalNumberField
                    id="playground-temperature"
                    label="Temperature"
                    help="How varied the answer is, from 0 (the likeliest token every time) to 2. Unset keeps the model's default; your custom models answer at 0, the way they were scored."
                    value={settings.temperature}
                    onValueChange={(temperature) => change({ temperature })}
                    min={0}
                    max={2}
                    step={0.01}
                    largeStep={0.1}
                    fallback={0.7}
                    format={TWO}
                />
                <ReasoningControl target={target} settings={settings} onChange={change} />
            </Group>
            <Group title="Format options">
                <FormatControl target={target} settings={settings} onChange={change} />
                <FunctionsControl target={target} settings={settings} onChange={change} />
            </Group>
            <Group title="Sampling" open={false}>
                <OptionalNumberField
                    id="playground-top-p"
                    label="Top P"
                    help="Sample only from the likeliest tokens whose probabilities add up to this share. Unset keeps the model's default."
                    value={settings.top_p}
                    onValueChange={(top_p) => change({ top_p })}
                    min={0.01}
                    max={1}
                    step={0.01}
                    fallback={0.9}
                    format={TWO}
                />
                <OptionalNumberField
                    id="playground-top-k"
                    label="Top K"
                    help="Sample only from this many of the likeliest tokens. An engine extension; unset keeps the model's default."
                    value={settings.top_k}
                    onValueChange={(top_k) => change({ top_k })}
                    min={1}
                    max={200}
                    step={1}
                    fallback={40}
                    format={WHOLE}
                />
                <OptionalNumberField
                    id="playground-min-p"
                    label="Min P"
                    help="Drop tokens less likely than this share of the likeliest one. An engine extension; unset keeps the model's default."
                    value={settings.min_p}
                    onValueChange={(min_p) => change({ min_p })}
                    min={0}
                    max={1}
                    step={0.01}
                    fallback={0.05}
                    format={TWO}
                />
                <OptionalNumberField
                    id="playground-presence"
                    label="Presence penalty"
                    help="Above 0 favours tokens that have not appeared yet, so the answer moves to new topics; below 0 does the opposite. Unset: 0."
                    value={settings.presence_penalty}
                    onValueChange={(presence_penalty) => change({ presence_penalty })}
                    min={-2}
                    max={2}
                    step={0.1}
                    fallback={0}
                    format={TWO}
                />
                <OptionalNumberField
                    id="playground-frequency"
                    label="Frequency penalty"
                    help="Above 0 lowers a token's odds the more often it has appeared, so the answer repeats itself less. Unset: 0."
                    value={settings.frequency_penalty}
                    onValueChange={(frequency_penalty) => change({ frequency_penalty })}
                    min={-2}
                    max={2}
                    step={0.1}
                    fallback={0}
                    format={TWO}
                />
                <OptionalNumberField
                    id="playground-repetition"
                    label="Repetition penalty"
                    help="Above 1 discourages repeating any token seen so far, prompt included; 1 changes nothing. An engine extension; unset keeps the model's default."
                    value={settings.repetition_penalty}
                    onValueChange={(repetition_penalty) => change({ repetition_penalty })}
                    min={0.1}
                    max={2}
                    step={0.01}
                    fallback={1.1}
                    format={TWO}
                />
                <StopControl settings={settings} onChange={change} />
                <OptionalNumberField
                    id="playground-seed"
                    label="Seed"
                    help="The same seed and inputs sample the same way, as far as the engine allows. Unset samples freshly each time."
                    value={settings.seed}
                    onValueChange={(seed) => change({ seed })}
                    min={0}
                    max={2147483647}
                    step={1}
                    slider={false}
                    fallback={42}
                    format={WHOLE}
                />
            </Group>
        </div>
    );
}
