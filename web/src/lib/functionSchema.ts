import { newId } from "./playground";

export const PARAM_TYPES = ["string", "number", "integer", "boolean", "array", "object"] as const;
export type ParamType = (typeof PARAM_TYPES)[number];

const JSON_TYPES = new Set<string>([...PARAM_TYPES, "null"]);
const FUNCTION_NAME = /^[a-zA-Z0-9_-]+$/;
export const NAME_LIMIT = 64;

type Schema = Record<string, unknown>;

export type ParamRow = {
    id: string;
    name: string;
    type: ParamType;
    required: boolean;
    description: string;
    rest: Schema;
};

export type Starter = { label: string; name: string; description: string; parameters: Schema };

export type PastedTool = { name: string | null; description: string | null; parameters: Schema };

export const EMPTY_PARAMETERS: Schema = { type: "object", properties: {}, required: [] };

export const STARTERS: Starter[] = [
    {
        label: "Weather",
        name: "get_weather",
        description: "Get the current weather in a city.",
        parameters: {
            type: "object",
            properties: {
                city: { type: "string", description: "The city, such as Paris" },
                unit: {
                    type: "string",
                    description: "The temperature unit",
                    enum: ["celsius", "fahrenheit"],
                },
            },
            required: ["city"],
        },
    },
    {
        label: "Web search",
        name: "web_search",
        description: "Search the web and return the top results.",
        parameters: {
            type: "object",
            properties: {
                query: { type: "string", description: "What to search for" },
                max_results: { type: "integer", description: "How many results, 1 to 10" },
            },
            required: ["query"],
        },
    },
    {
        label: "Calculator",
        name: "calculate",
        description: "Evaluate an arithmetic expression.",
        parameters: {
            type: "object",
            properties: {
                expression: { type: "string", description: "The expression, such as (2 + 3) * 4" },
            },
            required: ["expression"],
        },
    },
];

function isObject(value: unknown): value is Schema {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isParamType(value: unknown): value is ParamType {
    return typeof value === "string" && (PARAM_TYPES as readonly string[]).includes(value);
}

export function pretty(value: unknown): string {
    return JSON.stringify(value, null, 2);
}

export function nameProblem(name: string, taken: string[]): string | null {
    if (!name) {
        return "Name the function.";
    }
    if (name.length > NAME_LIMIT) {
        return `Use at most ${NAME_LIMIT} characters.`;
    }
    if (!FUNCTION_NAME.test(name)) {
        return "Use only letters, digits, underscores and dashes.";
    }
    if (taken.includes(name)) {
        return `Another function is already named ${name}.`;
    }
    return null;
}

function typeProblem(where: string, type: unknown): string | null {
    const types = Array.isArray(type) ? type : [type];
    const known = types.length > 0 && types.every((item) => JSON_TYPES.has(item as string));
    return type === undefined || known ? null : `${where} has an unknown type.`;
}

function propertiesProblem(properties: unknown, required: unknown): string | null {
    if (properties !== undefined && !isObject(properties)) {
        return '"properties" must be an object.';
    }
    for (const [key, value] of Object.entries(properties ?? {})) {
        if (!isObject(value)) {
            return `Parameter ${key} must be an object.`;
        }
        const problem = typeProblem(`Parameter ${key}`, value.type);
        if (problem) {
            return problem;
        }
    }
    if (required === undefined) {
        return null;
    }
    if (!Array.isArray(required) || !required.every((item) => typeof item === "string")) {
        return '"required" must be a list of parameter names.';
    }
    const missing = required.find((item) => !(item in (properties ?? {})));
    return missing === undefined ? null : `"required" names ${missing}, which is not a parameter.`;
}

export function parsedSchema(text: string): { schema: Schema } | { problem: string } {
    let value: unknown;
    try {
        value = JSON.parse(text);
    } catch (error) {
        return { problem: error instanceof Error ? error.message : "Not valid JSON." };
    }
    if (!isObject(value)) {
        return { problem: "Parameters are a JSON object." };
    }
    if (value.type !== "object") {
        return { problem: 'Parameters need "type": "object" at the top.' };
    }
    const problem = propertiesProblem(value.properties, value.required);
    return problem ? { problem } : { schema: value };
}

export function pastedTool(text: string): PastedTool | null {
    let value: unknown;
    try {
        value = JSON.parse(text);
    } catch {
        return null;
    }
    if (!isObject(value)) {
        return null;
    }
    const wrapped = value.type === "function" && isObject(value.function);
    const bare = value.type === undefined && typeof value.name === "string";
    const found = wrapped ? (value.function as Schema) : bare ? value : null;
    if (!found) {
        return null;
    }
    return {
        name: typeof found.name === "string" ? found.name : null,
        description: typeof found.description === "string" ? found.description : null,
        parameters: isObject(found.parameters) ? found.parameters : EMPTY_PARAMETERS,
    };
}

export function rowsOf(schema: Schema): ParamRow[] | string {
    const properties = isObject(schema.properties) ? schema.properties : {};
    const required = new Set(Array.isArray(schema.required) ? schema.required : []);
    const rows: ParamRow[] = [];
    for (const [name, raw] of Object.entries(properties)) {
        const { type, description, ...rest } = raw as Schema;
        if (!isParamType(type)) {
            return `Parameter ${name} has a type the form does not edit; use JSON.`;
        }
        if (description !== undefined && typeof description !== "string") {
            return `Parameter ${name} has a description that is not text; use JSON.`;
        }
        rows.push({
            id: newId(),
            name,
            type,
            required: required.has(name),
            description: description ?? "",
            rest,
        });
    }
    return rows;
}

export function schemaOf(rows: ParamRow[], base: Schema): Schema {
    const { type: _type, properties: _properties, required: _required, ...rest } = base;
    const named = rows.filter((row) => row.name.trim());
    const properties = Object.fromEntries(
        named.map((row) => [
            row.name.trim(),
            {
                type: row.type,
                ...(row.description.trim() ? { description: row.description.trim() } : {}),
                ...row.rest,
            },
        ]),
    );
    const required = named.filter((row) => row.required).map((row) => row.name.trim());
    return { type: "object", properties, required, ...rest };
}

export function rowsProblem(rows: ParamRow[]): string | null {
    const names = rows.map((row) => row.name.trim());
    if (names.some((name) => !name)) {
        return "Name every parameter, or remove the empty row.";
    }
    const twice = names.find((name, index) => names.indexOf(name) !== index);
    return twice ? `Two parameters are named ${twice}.` : null;
}

export function restFor(type: ParamType): Schema {
    return type === "array" ? { items: { type: "string" } } : {};
}

export function signature(name: string, parameters: string): string {
    const found = parsedSchema(parameters);
    const keys =
        "schema" in found && isObject(found.schema.properties)
            ? Object.keys(found.schema.properties)
            : [];
    return `${name}(${keys.join(", ")})`;
}
