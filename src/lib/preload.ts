import "server-only";
// Data for the first HTML: server pages hand these to SWR as `fallback`, keyed exactly like the client's
// requests, so a page renders with content before any JavaScript runs (and SWR revalidates after hydration).
import { desc } from "drizzle-orm";
import { db, schema } from "./db";
import { config, paidCalls } from "./config";
import { checkModels, modelResolutions } from "./ai/models";
import { totalSpend } from "./ai/client";
import { canvasView, papersTableView, projectView, questionsView, rankingTableView } from "./views";
import { exportPreview } from "./api";

/** GET /api/projects */
export function projectsList() {
  const rows = db.select().from(schema.projects).orderBy(desc(schema.projects.updatedAt)).all();
  return { projects: rows.map((p) => ({ id: p.id, title: p.title, idea: p.idea, currentStage: p.currentStage, status: p.status, stageStates: p.stageStates, createdAt: p.createdAt, updatedAt: p.updatedAt })) };
}

/** GET /api/status */
export async function statusView() {
  await checkModels();
  return {
    production: config.production,
    paidCalls,
    mockMode: config.mockMode,
    mockAi: config.mockAi,
    models: modelResolutions(),
    spendUsd: totalSpend(),
    budgetUsd: config.budgetUsd,
    keys: { xai: !!config.xaiApiKey, openalex: !!config.openalexApiKey, contactEmail: !!config.contactEmail },
    maxResultsPerQuery: config.maxResultsPerQuery,
    simulatedFailures: config.simulateFailure,
  };
}

const SESSION_VIEWS = { canvas: canvasView, papers: papersTableView, ranking: rankingTableView, questions: questionsView, "export/markdown?preview=1": (id: string) => exportPreview(id, "markdown") } as const;
export type SessionView = keyof typeof SESSION_VIEWS;

export const plain = <T,>(x: T): T => JSON.parse(JSON.stringify(x));

/** The project plus the named views. A view that fails is left out (the client fetches it and shows its own
 *  error); an unknown project gives nothing, so the client's "could not open" state handles it. */
export async function sessionFallback(id: string, views: SessionView[], opts: { status?: boolean } = {}) {
  const base = `/api/projects/${id}`;
  const out: Record<string, unknown> = {};
  try {
    out[base] = plain(projectView(id));
  } catch {
    return out;
  }
  for (const v of views) {
    try {
      out[`${base}/${v}`] = plain(SESSION_VIEWS[v](id));
    } catch {}
  }
  if (opts.status) out["/api/status"] = plain(await statusView());
  return out;
}
