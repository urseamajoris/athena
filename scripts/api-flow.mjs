// Drives a whole review through the HTTP API (no UI), approving every checkpoint with the AI's proposals.
// Usage: node scripts/api-flow.mjs [baseUrl] [--until=N] [--project=ID]
// Signs up a fresh user, or logs in with FLOW_EMAIL / FLOW_PASSWORD (needed with --project=ID).
import { Client } from "./lib/client.mjs";
import { pathToFileURL } from "node:url";
const base = process.argv.find((a) => a.startsWith("http")) ?? "http://localhost:3000";
const until = Number(process.argv.find((a) => a.startsWith("--until="))?.split("=")[1] ?? 9);
let pid = process.argv.find((a) => a.startsWith("--project="))?.split("=")[1];
const IDEA = "What is the knowledge gap in implementing telemedicine in Southeast Asia?";
const ANSWERS = [
  "Mainly patients and health workers in ASEAN countries, especially rural and underserved areas; health-system decision makers too.",
  "Implementation outcomes: adoption/uptake, barriers and facilitators, acceptability, and policy or infrastructure readiness.",
  "Publications from 2015 onwards; any study design including qualitative studies, surveys and systematic or scoping reviews.",
  "Both public and private health systems, primary care and hospital teleconsultation.",
  "English-language papers are fine.",
];

let client = new Client(base, "flow");
const call = (path, body, method) => client.json(`/api/projects${path}`, { body, method });
const p = (s) => `/${pid}/${s}`;
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

async function waitStage(n) {
  for (;;) {
    const v = await call(`/${pid}`);
    const st = v.project.stageStates[String(n)];
    const j = v.jobs[String(n)];
    if (st === "needs_review" || st === "approved") return v;
    if (st === "failed") throw new Error(`stage ${n} failed: ${j?.error}`);
    if (j) process.stdout.write(`\r  stage ${n}: ${j.progress.done}/${j.progress.total} ${j.progress.message.slice(0, 70).padEnd(70)}`);
    await new Promise((r) => setTimeout(r, 2000));
  }
}

/** Runs the whole flow for `c` (a signed-in Client) and returns the project id. */
export async function runFlow(c, opts = {}) {
  client = c;
  pid = opts.project;
  return main(opts.until ?? until);
}

async function main(until) {
  if (!pid) {
    pid = (await call("", { idea: IDEA })).id;
    log("project", pid);
    await call(p("stages/1/approve"), {});
  }
  if (until >= 2) {
    let s = await call(p("scoping/start"), {});
    let i = 0;
    while (!s.done && s.awaitingAnswer) {
      log("Q:", s.messages.at(-1).text);
      s = await call(p("scoping/answer"), { text: ANSWERS[i++ % ANSWERS.length] });
    }
    log("scoping done after", s.asked, "questions");
    s = await call(p("scoping/topics"), {});
    log("topics:", s.topics.map((t) => t.name).join(" | "));
    await call(p("stages/2/approve"), {});
  }
  if (until >= 3) {
    const q = await call(p("search/build"), {});
    for (const t of q.topics) for (const x of t.queries) log(`  [${x.database}] ${t.name}: ${x.queryString}`);
    const d = await call(p("search/dryrun-all"), {});
    log("dry runs:", d.results.map((r) => r.count ?? `ERR ${r.error}`).join(", "));
    await call(p("stages/3/approve"), {}); // starts retrieval
  }
  for (let n = 4; n <= Math.min(until, 9); n++) {
    const v = await waitStage(n);
    process.stdout.write("\n");
    const c = v.costs[String(n)];
    log(`stage ${n} ready`, c ? `(AI ${c.calls} calls, $${c.cost.toFixed(4)})` : "");
    if (n === 4) {
      const r = await call(p("retrieval"));
      log(`  unique papers: ${r.uniquePapers}; runs: ${r.runs.map((x) => `${x.database}:${x.status}:${x.fetchedCount}/${x.resultCount}(+${x.newUniqueCount})`).join(" ")}`);
    }
    if (n === 7) {
      const a = await call(p("appraisals"));
      log(`  appraisals: ${a.appraisals.map((x) => `${x.textSource}/${x.status} v${x.counts.verified} u${x.counts.unverified}`).join("; ")}`);
    }
    if (n === 9) {
      const q = await call(p("questions"));
      q.questions.forEach((x, i) => log(`  RQ${i + 1}: ${x.text} [novelty: ${x.noveltyMatches.length} matches]`));
      await call(p(`questions/${q.questions[0].id}/choose`), {});
    }
    await call(p(`stages/${n}/approve`), {});
  }
  log("done; project", pid);
  return pid;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  (async () => {
    if (process.env.FLOW_EMAIL) await client.login(process.env.FLOW_EMAIL, process.env.FLOW_PASSWORD ?? "");
    else await client.signup(`flow-${Date.now()}@example.org`);
    await main(until);
  })().catch((e) => {
    console.error("\nFAILED:", e.message);
    process.exit(1);
  });
}
