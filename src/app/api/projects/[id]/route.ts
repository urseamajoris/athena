import { NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { projectView } from "@/lib/views";
import { apiRoute } from "@/lib/http";
import { HttpError, logDecision } from "@/lib/project";
import { ownedProject, requireUser } from "@/lib/auth/server";
import { nowIso } from "@/lib/util";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

export const GET = apiRoute("project", async (_req, ctx: Ctx) => {
  const { id } = await ctx.params;
  await ownedProject(id, await requireUser());
  return NextResponse.json(await projectView(id));
});

/** Rename. The title is a label only: it changes no stage and marks nothing stale. */
export const PATCH = apiRoute("project", async (req, ctx: Ctx) => {
  const { id } = await ctx.params;
  const p = await ownedProject(id, await requireUser());
  const body = z.object({ title: z.string().trim().min(1, "Give the project a name.").max(120) }).safeParse(await req.json().catch(() => ({})));
  if (!body.success) throw new HttpError(400, body.error.issues[0].message);
  await db.update(schema.projects).set({ title: body.data.title, updatedAt: nowIso() }).where(eq(schema.projects.id, id)).run();
  await logDecision(id, p.currentStage, "project_renamed", p.title, body.data.title);
  return NextResponse.json({ ok: true });
});

export const DELETE = apiRoute("project", async (_req, ctx: Ctx) => {
  const { id } = await ctx.params;
  await ownedProject(id, await requireUser());
  await db.delete(schema.projects).where(eq(schema.projects.id, id)).run();
  return NextResponse.json({ ok: true });
});
