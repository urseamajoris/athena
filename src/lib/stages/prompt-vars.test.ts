import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { PROMPT_VARS, type PromptName } from "./prompt-vars";

const DIR = path.resolve(process.cwd(), "prompts");

/** The latest version of a prompt, read the way src/lib/ai/prompts.ts reads it. */
function latest(name: string) {
  const files = fs.readdirSync(DIR).filter((f) => f.startsWith(`${name}.v`) && f.endsWith(".md"));
  const best = files.map((f) => ({ f, v: Number(f.slice(name.length + 2, -3)) })).sort((a, b) => b.v - a.v)[0];
  assert.ok(best, `no prompt file for ${name}`);
  const raw = fs.readFileSync(path.join(DIR, best.f), "utf8");
  const system = raw.match(/^# system\s*\n([\s\S]*?)(?=^# user\s*$)/m)?.[1]?.trim();
  const user = raw.match(/^# user\s*\n([\s\S]*)$/m)?.[1]?.trim();
  return { file: best.f, version: best.v, raw, system, user };
}
const placeholders = (text: string) => [...new Set([...text.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]))].sort();

test("every prompt's latest version has both sections and uses exactly the variables its caller supplies", () => {
  for (const name of Object.keys(PROMPT_VARS) as PromptName[]) {
    const p = latest(name);
    assert.ok(p.system && p.user, `${p.file} needs "# system" and "# user" sections`);
    assert.deepEqual(placeholders(p.raw), [...PROMPT_VARS[name]].sort(), `${p.file}: placeholders and PROMPT_VARS.${name} differ`);
  }
});

test("the prompts in use are the versions written around the research question", () => {
  const versions = Object.fromEntries((Object.keys(PROMPT_VARS) as PromptName[]).map((n) => [n, latest(n).version]));
  assert.deepEqual(versions, { scoping_turn: 2, question_draft: 1, scoping_topics: 3, search_builder: 3, paper_summary: 2, ranking: 2, topic_importance: 2, appraisal: 2, synthesis: 6, research_questions: 5 });
  // Every stage after the question is judged against it.
  for (const name of ["scoping_topics", "search_builder", "paper_summary", "ranking", "topic_importance", "appraisal", "synthesis", "research_questions"] as PromptName[]) {
    assert.ok(latest(name).user!.includes("{{question}}"), `${name} must be given the working research question`);
  }
});

test("prompts carry no JSON schema and no provider or model names (the schema is sent separately)", () => {
  for (const name of Object.keys(PROMPT_VARS) as PromptName[]) {
    const p = latest(name);
    assert.ok(!/"type"\s*:\s*"(object|array|string)"|additionalProperties|\$schema/.test(p.raw), `${p.file} contains a JSON schema`);
    assert.ok(!/\b(xai|grok|claude|anthropic|opus)\b/i.test(p.raw), `${p.file} names a provider or model`);
  }
});
