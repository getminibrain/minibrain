import { NumberField, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "obp-ui";
import { FormGroup, FormRow } from "~/components/FormRows";
import type { Cleanup } from "./cleanup";

export type CleanupDefaults = { rare: number; maxTokens: number; perLabel: number };

const WHOLE = { maximumFractionDigits: 0 } as const;

const CONFLICT_CHOICES = [
    { value: "common", label: "Keep the most common label" },
    { value: "drop", label: "Drop those inputs" },
];

const PERSONAL_CHOICES = [
    { value: "mask", label: "Mask them" },
    { value: "drop", label: "Drop those rows" },
];

function Choice({
    label,
    value,
    choices,
    disabled,
    onChange,
}: {
    label: string;
    value: string;
    choices: { value: string; label: string }[];
    disabled: boolean;
    onChange: (value: string) => void;
}) {
    return (
        <Select
            value={value}
            disabled={disabled}
            onValueChange={(next) => next && onChange(String(next))}
        >
            <SelectTrigger aria-label={label} className="w-full max-w-64">
                <SelectValue />
            </SelectTrigger>
            <SelectContent>
                {choices.map((choice) => (
                    <SelectItem key={choice.value} value={choice.value}>
                        {choice.label}
                    </SelectItem>
                ))}
            </SelectContent>
        </Select>
    );
}

function Amount({
    label,
    value,
    min,
    max,
    unit,
    disabled,
    onChange,
}: {
    label: string;
    value: number;
    min: number;
    max: number;
    unit: string;
    disabled: boolean;
    onChange: (value: number) => void;
}) {
    return (
        <NumberField
            aria-label={label}
            value={value}
            min={min}
            max={max}
            unit={unit}
            format={WHOLE}
            disabled={disabled}
            onValueChange={(next) => next !== null && onChange(next)}
            groupClassName="w-32"
        />
    );
}

export function CleanupGroup({
    cleanup,
    defaults,
    onChange,
}: {
    cleanup: Cleanup;
    defaults: CleanupDefaults;
    onChange: (cleanup: Cleanup) => void;
}) {
    const set = (patch: Partial<Cleanup>) => onChange({ ...cleanup, ...patch });
    return (
        <FormGroup title="Clean up">
            <FormRow
                id="cleanup-conflicts"
                label="Several labels"
                tip="For an input that carries more than one label: keep the label it has most often, or drop the input."
                check={{
                    checked: Boolean(cleanup.conflicts),
                    onCheckedChange: (on) => set({ conflicts: on ? "common" : null }),
                }}
            >
                <Choice
                    label="For an input with several labels"
                    value={cleanup.conflicts ?? "common"}
                    choices={CONFLICT_CHOICES}
                    disabled={!cleanup.conflicts}
                    onChange={(value) => set({ conflicts: value as Cleanup["conflicts"] })}
                />
            </FormRow>
            <FormRow
                id="cleanup-per-label"
                label="Cap per label"
                tip="Keeps at most this many rows of each label."
                check={{
                    checked: Boolean(cleanup.per_label),
                    onCheckedChange: (on) => set({ per_label: on ? defaults.perLabel : null }),
                }}
            >
                <Amount
                    label="Most rows a label keeps"
                    value={cleanup.per_label ?? defaults.perLabel}
                    min={1}
                    max={50_000_000}
                    unit="rows"
                    disabled={!cleanup.per_label}
                    onChange={(value) => set({ per_label: value })}
                />
            </FormRow>
            <FormRow
                id="cleanup-rare"
                label="Rare labels"
                tip="Drops labels with fewer rows than this."
                check={{
                    checked: Boolean(cleanup.rare),
                    onCheckedChange: (on) => set({ rare: on ? defaults.rare : null }),
                }}
            >
                <Amount
                    label="Keep labels with at least this many rows"
                    value={cleanup.rare ?? defaults.rare}
                    min={2}
                    max={100_000}
                    unit="rows"
                    disabled={!cleanup.rare}
                    onChange={(value) => set({ rare: value })}
                />
            </FormRow>
            <FormRow
                id="cleanup-long"
                label="Long inputs"
                tip="Drops rows whose input runs past this many tokens, estimated from its length."
                check={{
                    checked: Boolean(cleanup.max_tokens),
                    onCheckedChange: (on) => set({ max_tokens: on ? defaults.maxTokens : null }),
                }}
            >
                <Amount
                    label="Keep inputs up to this many tokens"
                    value={cleanup.max_tokens ?? defaults.maxTokens}
                    min={1}
                    max={1_000_000}
                    unit="tokens"
                    disabled={!cleanup.max_tokens}
                    onChange={(value) => set({ max_tokens: value })}
                />
            </FormRow>
            <FormRow
                id="cleanup-personal"
                label="Personal data"
                tip="Masks or drops emails, phone numbers, card numbers and IBANs found by pattern. Names and addresses can slip through."
                check={{
                    checked: Boolean(cleanup.personal_data),
                    onCheckedChange: (on) => set({ personal_data: on ? "mask" : null }),
                }}
            >
                <Choice
                    label="Emails, phone numbers, card numbers and IBANs"
                    value={cleanup.personal_data ?? "mask"}
                    choices={PERSONAL_CHOICES}
                    disabled={!cleanup.personal_data}
                    onChange={(value) => set({ personal_data: value as Cleanup["personal_data"] })}
                />
            </FormRow>
        </FormGroup>
    );
}
