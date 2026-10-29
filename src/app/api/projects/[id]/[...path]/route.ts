import { dispatch, routePattern } from "@/lib/api";
import { apiRoute } from "@/lib/http";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string; path: string[] }> };

// Telemetry records the matched route pattern (e.g. "claims/:cid"), never the IDs.
const handle = async (req: Request, ctx: Ctx) => {
  const { id, path } = await ctx.params;
  return apiRoute(`project/${routePattern(req.method, path)}`, () => dispatch(req, id, path))(req, ctx);
};
export { handle as GET, handle as POST, handle as PATCH, handle as PUT, handle as DELETE };
