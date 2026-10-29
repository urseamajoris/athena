import { NextResponse } from "next/server";
import { z } from "zod";
import { apiRoute } from "@/lib/http";
import { HttpError } from "@/lib/project";
import { requireAdmin } from "@/lib/auth/server";
import { userAction } from "@/lib/admin/actions";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };
const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("disable") }),
  z.object({ action: z.literal("enable") }),
  z.object({ action: z.literal("delete") }),
  z.object({ action: z.literal("reset_password") }),
  z.object({ action: z.literal("set_role"), role: z.enum(["user", "admin"]) }),
]);

export const POST = apiRoute("admin/users/:id", async (req, ctx: Ctx) => {
  const admin = await requireAdmin();
  const b = Body.safeParse(await req.json().catch(() => ({})));
  if (!b.success) throw new HttpError(400, "Unknown action.");
  return NextResponse.json(await userAction(admin, (await ctx.params).id, b.data));
});
