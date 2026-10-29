import { dispatch } from "@/lib/api";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string; path: string[] }> };
const handle = async (req: Request, ctx: Ctx) => {
  const { id, path } = await ctx.params;
  return (await dispatch(req, id, path));
};
export { handle as GET, handle as POST, handle as PATCH, handle as PUT, handle as DELETE };
