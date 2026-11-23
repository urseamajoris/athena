import { canvasView, projectView, retrievalView } from "@/lib/views";
import { ownedProject, requireUser } from "@/lib/auth/server";
import { errorResponse } from "@/lib/http";
import { aiState } from "@/lib/settings";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

/**
 * Server-sent events: streams the project's stage states, latest job per stage, and live retrieval
 * runs. State is read from SQLite, so closing the tab or refreshing never affects a running job.
 */
export async function GET(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  try {
    await ownedProject(id, await requireUser());
  } catch (e) {
    return errorResponse(e);
  }
  const enc = new TextEncoder();
  let timer: ReturnType<typeof setInterval> | undefined;
  const stream = new ReadableStream({
    async start(controller) {
      let last = "";
      const tick = async () => {
        try {
          const v = (await projectView(id));
          const running = Object.values(v.jobs).some((j) => j && (j.status === "running" || j.status === "queued"));
          const payload = JSON.stringify({ stageStates: v.project.stageStates, staleReasons: v.project.staleReasons, jobs: v.jobs, costs: v.costs, retrieval: running || v.project.stageStates["4"] !== "not_started" ? (await retrievalView(id)) : null, canvas: (await canvasView(id)), ai: await aiState() });
          if (payload !== last) {
            last = payload;
            controller.enqueue(enc.encode(`data: ${payload}\n\n`));
          } else {
            controller.enqueue(enc.encode(`: ping\n\n`));
          }
        } catch (e) {
          controller.enqueue(enc.encode(`event: error\ndata: ${JSON.stringify({ error: (e as Error).message })}\n\n`));
        }
      };
      (await tick());
      timer = setInterval(tick, 800);
      req.signal.addEventListener("abort", () => {
        clearInterval(timer);
        try {
          controller.close();
        } catch {}
      });
    },
    cancel() {
      clearInterval(timer);
    },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" } });
}
