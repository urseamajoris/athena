import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { transformJSONSchema } from "@anthropic-ai/sdk/lib/transform-json-schema";
import { toModelSchema } from "./schema";
import * as aiSchemas from "../stages/ai-schemas";

/** The only keywords structured outputs take. Anything else in a schema is rejected or ignored by the API. */
const ALLOWED = new Set(["type", "properties", "required", "additionalProperties", "items", "enum", "const", "anyOf", "allOf", "$ref", "$defs", "description", "title", "format", "minItems"]);
const FORMATS = new Set(["date-time", "time", "date", "duration", "email", "hostname", "uri", "ipv4", "ipv6", "uuid"]);
// "Schema complexity limits", https://platform.claude.com/docs/en/build-with-claude/structured-outputs (read 2026-11-16).
const MAX_OPTIONAL = 24;
const MAX_UNIONS = 16;

type Node = Record<string, unknown>;

/** Every schema node of `root`, with where it sits. */
function* nodes(n: Node, where: string): Generator<[Node, string]> {
  yield [n, where];
  for (const [k, v] of Object.entries((n.properties as Node) ?? {})) yield* nodes(v as Node, `${where}.${k}`);
  for (const [k, v] of Object.entries((n.$defs as Node) ?? {})) yield* nodes(v as Node, `${where}.$defs.${k}`);
  if (n.items) yield* nodes(n.items as Node, `${where}[]`);
  for (const key of ["anyOf", "allOf"]) for (const [i, v] of ((n[key] as Node[]) ?? []).entries()) yield* nodes(v, `${where}.${key}[${i}]`);
}

function assertSendable(schema: Node, name: string) {
  assert.equal(schema.type, "object", `${name}: the top level is an object`);
  for (const [n, where] of nodes(schema, name)) {
    for (const k of Object.keys(n)) assert.ok(ALLOWED.has(k), `${where}: keyword "${k}" is not supported by structured outputs`);
    assert.ok(!Array.isArray(n.type), `${where}: one type per node (unions are anyOf)`);
    if (n.type === "object") {
      assert.equal(n.additionalProperties, false, `${where}: every object needs additionalProperties: false`);
      assert.ok(n.properties && typeof n.properties === "object", `${where}: an object lists its properties`);
      for (const r of (n.required as string[]) ?? []) assert.ok(r in (n.properties as Node), `${where}: required "${r}" is a listed property`);
    }
    if (n.minItems !== undefined) assert.ok(n.minItems === 0 || n.minItems === 1, `${where}: only minItems 0 or 1 is supported`);
    if (n.format !== undefined) assert.ok(FORMATS.has(n.format as string), `${where}: format "${n.format}" is not supported`);
    if (!("enum" in n) && !("const" in n) && !("anyOf" in n) && !("allOf" in n) && !("$ref" in n)) assert.ok(n.type !== undefined, `${where}: has a type`);
  }
  // The SDK's own converter (what its zod helper sends) finds nothing left to remove or rewrite.
  assert.deepEqual(transformJSONSchema(schema), schema, `${name}: unchanged by the SDK's structured-output transform`);
  // The API's published complexity limits for one request's schema: a schema over them is rejected with a 400.
  const all = [...nodes(schema, name)].map(([n]) => n);
  const optional = all.filter((n) => n.type === "object").reduce((a, n) => a + Object.keys(n.properties as Node).filter((k) => !((n.required as string[]) ?? []).includes(k)).length, 0);
  const unions = all.filter((n) => "anyOf" in n).length;
  assert.ok(optional <= MAX_OPTIONAL, `${name}: ${optional} optional fields (the limit is ${MAX_OPTIONAL}); make fields required, or nullable where the limit allows`);
  assert.ok(unions <= MAX_UNIONS, `${name}: ${unions} fields with a union type such as nullable (the limit is ${MAX_UNIONS})`);
}

test("every AI output schema converts to a schema structured outputs accept", () => {
  const found = Object.entries(aiSchemas).filter(([, v]) => v instanceof z.ZodType) as [string, z.ZodType][];
  assert.ok(found.length >= 5, `found only ${found.length} zod schemas in stages/ai-schemas.ts`);
  for (const [name, s] of found) {
    const out = toModelSchema(s);
    assertSendable(out, name);
    assert.ok(!JSON.stringify(out).includes("$schema"));
  }
});

test("limits are removed from the schema and restated in the description", () => {
  const s = toModelSchema(
    z.object({
      name: z.string().trim().min(1).max(80),
      note: z.string().max(400).nullable(),
      plain: z.string().nullable(),
      tags: z.array(z.string()).min(4).max(8),
      some: z.array(z.string()).min(1),
      three: z.array(z.object({ k: z.string() })).length(3),
      score: z.number().int().min(0).max(5),
      year: z.number().int().nullable(),
      kind: z.enum(["a", "b"]),
      maybe: z.enum(["a", "b"]).nullable(),
      opt: z.string().optional(),
      when: z.string().describe("When it happened."),
    }),
  ) as { properties: Record<string, Node>; required: string[]; additionalProperties: boolean };
  assertSendable(s as unknown as Node, "sample");
  const p = s.properties;
  assert.deepEqual(p.name, { type: "string", description: "Length: 1 to 80 characters." });
  assert.deepEqual(p.note, { anyOf: [{ type: "string", description: "Length: at most 400 characters." }, { type: "null" }] });
  assert.deepEqual(p.plain, { anyOf: [{ type: "string" }, { type: "null" }] }, "a list of types is sent as anyOf");
  assert.deepEqual(p.tags, { type: "array", items: { type: "string" }, description: "Items: 4 to 8 items." });
  assert.deepEqual(p.some, { type: "array", items: { type: "string" }, minItems: 1, description: "Items: at least 1 item." });
  assert.equal(p.three.description, "Items: exactly 3 items.");
  assert.equal((p.three.items as Node).additionalProperties, false);
  assert.deepEqual(p.score, { type: "integer", description: "Range: 0 to 5." });
  assert.equal(JSON.stringify(p.year).includes("9007199254740991"), false, "safe-integer bounds are not a limit worth stating");
  assert.deepEqual(p.kind, { enum: ["a", "b"] });
  assert.deepEqual(p.maybe, { anyOf: [{ enum: ["a", "b"] }, { type: "null" }] });
  assert.equal(p.when.description, "When it happened.");
  assert.ok(!s.required.includes("opt"), "an optional field stays optional");
  assert.deepEqual(s.required, ["name", "note", "plain", "tags", "some", "three", "score", "year", "kind", "maybe", "when"]);
  assert.equal(s.additionalProperties, false);
});

test("shapes the model cannot be held to are refused when the schema is built, not sent", () => {
  assert.throws(() => toModelSchema(z.object({ r: z.record(z.string(), z.number()) })), /open-ended object/);
  assert.throws(() => toModelSchema(z.object({ u: z.unknown() })), /no type/);
  assert.throws(() => toModelSchema(z.object({ t: z.tuple([z.string(), z.number()]) })), /tuple/);
  assert.throws(() => toModelSchema(z.array(z.string())), /top level must be an object/);
});
