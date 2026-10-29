import { NextResponse } from "next/server";
import { z } from "zod";
import { db, schema } from "@/lib/db";
import { initialStageStates, logDecision } from "@/lib/project";
import { errorResponse } from "@/lib/api";
import { newId } from "@/lib/util";
import { projectsList } from "@/lib/preload";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json((await projectsList()));
}

export async function POST(req: Request) {
  try {
    const body = z.object({ idea: z.string().trim().min(10, "Please write at least a sentence about your idea.").max(4000) }).safeParse(await req.json().catch(() => ({})));
    if (!body.success) return NextResponse.json({ error: body.error.issues[0].message }, { status: 400 });
    const id = newId("prj");
    (await db.insert(schema.projects).values({ id, idea: body.data.idea, title: body.data.idea.slice(0, 90), stageStates: initialStageStates() }).run());
    (await logDecision(id, 1, "project_created", null, { idea: body.data.idea }));
    return NextResponse.json({ id });
  } catch (e) {
    return errorResponse(e);
  }
}
