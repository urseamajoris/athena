import { NextResponse } from "next/server";
import { z } from "zod";
import { db, schema } from "@/lib/db";
import { initialStageStates, logDecision } from "@/lib/project";
import { apiRoute } from "@/lib/http";
import { requireUser } from "@/lib/auth/server";
import { newId } from "@/lib/util";
import { projectsList } from "@/lib/preload";

export const dynamic = "force-dynamic";

export const GET = apiRoute("projects", async () => NextResponse.json(await projectsList((await requireUser()).id)));

export const POST = apiRoute("projects", async (req) => {
  const user = await requireUser();
  const body = z.object({ idea: z.string().trim().min(10, "Please write at least a sentence about your idea.").max(4000) }).safeParse(await req.json().catch(() => ({})));
  if (!body.success) return NextResponse.json({ error: body.error.issues[0].message }, { status: 400 });
  const id = newId("prj");
  await db.insert(schema.projects).values({ id, ownerId: user.id, idea: body.data.idea, title: body.data.idea.slice(0, 90), stageStates: initialStageStates() }).run();
  await logDecision(id, 1, "project_created", null, { idea: body.data.idea });
  return NextResponse.json({ id });
});
