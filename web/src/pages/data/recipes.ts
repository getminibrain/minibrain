import {
    IconCopyOff,
    IconDice5,
    IconFilter,
    IconLetterCaseLower,
    IconReplace,
    IconScale,
    IconStack2,
    IconTags,
} from "@tabler/icons-react";
import {
    INPUT,
    LABEL,
    type Step,
    USABLE,
    conflictsStep,
    literal,
    perLabelStep,
    wrappedSql,
} from "./cleanup";
import { quoted } from "./sql";

type IconComponent = typeof IconFilter;

export type RecipeSource = { table: string; input: string; label: string };

export type Recipe = {
    key: string;
    label: string;
    detail: string;
    icon: IconComponent;
    step: (others: RecipeSource[]) => Step | null;
};

const SAMPLE_ROWS = 1000;
const PER_LABEL = 100;

export const RECIPES: Recipe[] = [
    {
        key: "empty",
        icon: IconFilter,
        label: "Drop empty rows",
        detail: "Keep rows with both an input and a label",
        step: () => (table) => `SELECT * FROM ${table} WHERE ${USABLE}`,
    },
    {
        key: "duplicates",
        icon: IconCopyOff,
        label: "Remove duplicates",
        detail: "Keep the first row of each input",
        step: () => (table) =>
            `SELECT * FROM ${table} QUALIFY row_number() OVER (PARTITION BY ${INPUT} ORDER BY ${LABEL}) = 1`,
    },
    {
        key: "conflicts",
        icon: IconTags,
        label: "One label an input",
        detail: "Keep the label an input has most often",
        step: () => conflictsStep("common"),
    },
    {
        key: "relabel",
        icon: IconReplace,
        label: "Relabel with CASE",
        detail: "Rename or merge labels",
        step: () => (table) =>
            `SELECT * REPLACE (CASE label WHEN ${literal("old label")} THEN ${literal("new label")} ELSE label END AS label) FROM ${table}`,
    },
    {
        key: "normalize",
        icon: IconLetterCaseLower,
        label: "Trim and lowercase text",
        detail: "Spaces off both ends, lower case",
        step: () => (table) => `SELECT * REPLACE (lower(${INPUT}) AS input) FROM ${table}`,
    },
    {
        key: "combine",
        icon: IconStack2,
        label: "Combine sources",
        detail: "Add another source's rows, columns matched by name",
        step: (others) => {
            const other = others[0];
            if (!other) {
                return null;
            }
            return (table) =>
                `SELECT * FROM ${table} UNION ALL BY NAME SELECT ${quoted(other.input)} AS input, ${quoted(other.label)} AS label FROM ${quoted(other.table)}`;
        },
    },
    {
        key: "per_label",
        icon: IconScale,
        label: `${PER_LABEL} rows a label`,
        detail: "Balance labels by capping each one",
        step: () => perLabelStep(PER_LABEL),
    },
    {
        key: "sample",
        icon: IconDice5,
        label: "Random sample",
        detail: `${SAMPLE_ROWS.toLocaleString()} rows, the same ones on every run`,
        step: () => (table) =>
            `SELECT * FROM ${table} USING SAMPLE reservoir(${SAMPLE_ROWS} ROWS) REPEATABLE (7)`,
    },
];

export function recipeSql(recipe: Recipe, base: string, others: RecipeSource[]): string | null {
    const step = recipe.step(others);
    return step ? wrappedSql(base, step) : null;
}
