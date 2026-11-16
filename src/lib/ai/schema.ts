import { z } from "zod";

type Node = Record<string, unknown>;

/** String formats the API's structured outputs accept; any other `format` is left to zod. */
const STRING_FORMATS = new Set(["date-time", "time", "date", "duration", "email", "hostname", "uri", "ipv4", "ipv6", "uuid"]);

const isNode = (v: unknown): v is Node => !!v && typeof v === "object" && !Array.isArray(v);
const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && Math.abs(v) < Number.MAX_SAFE_INTEGER;

function span(label: string, min: unknown, max: unknown, unit = ""): string | null {
  const u = (v: number) => (unit ? ` ${v === 1 ? unit.replace(/s$/, "") : unit}` : "");
  if (num(min) && num(max)) return min === max ? `${label}: exactly ${min}${u(min)}.` : `${label}: ${min} to ${max}${u(max)}.`;
  if (num(max)) return `${label}: at most ${max}${u(max)}.`;
  if (num(min) && (min > 0 || !unit)) return `${label}: at least ${min}${u(min)}.`;
  return null;
}

/** The limits the schema cannot carry, in words, so the model still knows them. zod enforces them on the answer. */
function limits(n: Node): string {
  return [
    span("Length", n.minLength, n.maxLength, "characters"),
    typeof n.pattern === "string" ? `Pattern: ${n.pattern}` : null,
    typeof n.format === "string" && !STRING_FORMATS.has(n.format) ? `Format: ${n.format}.` : null,
    span("Items", n.minItems, n.maxItems, "items"),
    span("Range", n.minimum ?? n.exclusiveMinimum, n.maximum ?? n.exclusiveMaximum),
    num(n.multipleOf) ? `A multiple of ${n.multipleOf}.` : null,
  ].filter(Boolean).join(" ");
}

function convert(n: Node, where: string): Node {
  // zod writes a simple union as a list of types ("string" or "null"); it is sent as the equivalent anyOf.
  if (Array.isArray(n.type) && n.enum === undefined && n.const === undefined) {
    const { type, description, title, ...rest } = n;
    const anyOf = (type as string[]).map((t) => (t === "null" ? { type: "null" } : convert({ ...rest, type: t }, where)));
    return anyOf.length === 1 ? convert({ ...n, type: type[0] }, where) : { anyOf, ...(typeof description === "string" ? { description } : {}), ...(typeof title === "string" ? { title } : {}) };
  }
  const out: Node = {};
  if (isNode(n.$defs)) out.$defs = Object.fromEntries(Object.entries(n.$defs).map(([k, v]) => [k, convert(v as Node, `${where}.$defs.${k}`)]));
  if (typeof n.$ref === "string") return { ...out, $ref: n.$ref };

  if (Array.isArray(n.enum) && n.enum.length) out.enum = n.enum;
  if (n.const !== undefined) out.const = n.const;
  const literal = "enum" in out || "const" in out;
  const variants = Array.isArray(n.anyOf) ? n.anyOf : Array.isArray(n.oneOf) ? n.oneOf : null;
  if (variants) out.anyOf = variants.map((v, i) => convert(v as Node, `${where}.anyOf[${i}]`));
  else if (Array.isArray(n.allOf)) out.allOf = n.allOf.map((v, i) => convert(v as Node, `${where}.allOf[${i}]`));
  else if (!literal) {
    if (n.type === undefined) throw new Error(`AI output schema: ${where} has no type (z.any and z.unknown cannot be sent to the model)`);
    out.type = n.type;
  }
  const types = literal ? [] : [n.type];

  if (types.includes("object")) {
    if (isNode(n.additionalProperties)) throw new Error(`AI output schema: ${where} is an open-ended object (z.record), which the model's structured output does not support`);
    out.properties = Object.fromEntries(Object.entries(isNode(n.properties) ? n.properties : {}).map(([k, v]) => [k, convert(v as Node, `${where}.${k}`)]));
    if (Array.isArray(n.required)) out.required = n.required;
    out.additionalProperties = false;
  }
  if (types.includes("array")) {
    if (n.prefixItems !== undefined) throw new Error(`AI output schema: ${where} is a tuple, which the model's structured output does not support`);
    if (isNode(n.items)) out.items = convert(n.items, `${where}[]`);
    if (n.minItems === 0 || n.minItems === 1) out.minItems = n.minItems;
  }
  if (types.includes("string") && typeof n.format === "string" && STRING_FORMATS.has(n.format)) out.format = n.format;

  const description = [typeof n.description === "string" ? n.description : "", limits(n)].filter(Boolean).join(" ");
  if (description) out.description = description;
  if (typeof n.title === "string") out.title = n.title;
  return out;
}

/**
 * zod → the JSON Schema sent as the response format (`output_config.format`), so the model's answer is
 * constrained to it. Structured outputs take a subset of JSON Schema: every object closed
 * (`additionalProperties: false`), and no length, count, range or pattern keywords (only `minItems` 0 or 1 and a
 * few string formats). Those limits are removed from the schema and restated in the field's description; zod
 * still enforces every one of them on the answer.
 */
export function toModelSchema(schema: z.ZodType): Record<string, unknown> {
  const out = convert(z.toJSONSchema(schema, { target: "draft-2020-12", unrepresentable: "any" }) as Node, "(root)");
  if (out.type !== "object") throw new Error("AI output schema: the top level must be an object");
  return out;
}

export function zodErrorText(e: z.ZodError): string {
  return e.issues.slice(0, 12).map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
}
