import { z } from "zod";

const UNSUPPORTED = new Set(["minLength", "maxLength", "minItems", "maxItems", "pattern", "allOf", "$schema", "default", "format"]);

/** zod → JSON Schema for xAI response_format, with keywords xAI rejects/ignores stripped (zod still enforces them). */
export function toXaiSchema(schema: z.ZodType): Record<string, unknown> {
  const js = z.toJSONSchema(schema, { target: "draft-2020-12", unrepresentable: "any" }) as Record<string, unknown>;
  const strip = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(strip);
    if (node && typeof node === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(node)) {
        if (UNSUPPORTED.has(k)) continue;
        out[k] = strip(v);
      }
      return out;
    }
    return node;
  };
  return strip(js) as Record<string, unknown>;
}

export function zodErrorText(e: z.ZodError): string {
  return e.issues.slice(0, 12).map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
}
