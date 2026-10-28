import { projectView, retrievalView } from "@/lib/views";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

/**
 * Server-sent events: streams the project's stage states, latest job per stage, and live retrieval
 * runs. State is read from SQLite, so closing the tab or refreshing never affects a running job.
 */
export async function GET(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const enc = new TextEncoder();
  let timer: ReturnType<typeof setInterval> | undefined;
  const stream = new ReadableStream({
    start(controller) {
      let last = "";
      const tick = () => {
        try {
          const v = projectView(id);
          const running = Object.values(v.jobs).some((j) => j && (j.status === "running" || j.status === "queued"));
          const payload = JSON.stringify({ stageStates: v.project.stageStates, staleReasons: v.project.staleReasons, jobs: v.jobs, costs: v.costs, retrieval: running || v.project.stageStates["4"] !== "not_started" ? retrievalView(id) : null });
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
      tick();
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
