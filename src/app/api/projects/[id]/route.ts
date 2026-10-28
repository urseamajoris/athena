import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { projectView } from "@/lib/views";
import { errorResponse } from "@/lib/api";
import { getProject } from "@/lib/project";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  try {
    return NextResponse.json(projectView((await ctx.params).id));
  } catch (e) {
    return errorResponse(e);
  }
}

export async function DELETE(_req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    getProject(id);
    db.delete(schema.projects).where(eq(schema.projects.id, id)).run();
    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
