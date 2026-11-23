import { NextResponse } from "next/server";
import { z } from "zod";
import { apiRoute } from "@/lib/http";
import { HttpError } from "@/lib/project";
import { requireAdmin } from "@/lib/auth/server";
import { updateAiProvider } from "@/lib/admin/actions";
import { providerConfigStatus } from "@/lib/settings";

export const dynamic = "force-dynamic";

const ModelId = z.string().trim().min(2).max(120).regex(/^[a-zA-Z0-9._:/-]+$/, "Invalid model ID.").nullable();
const UpdateSchema = z.object({
  provider: z.enum(["anthropic", "gemini", "xai"]).optional(),
  model: ModelId.optional(),
  models: z
    .object({
      fast: ModelId.optional(),
      summary: ModelId.optional(),
      reasoning: ModelId.optional(),
    })
    .optional(),
});

export const GET = apiRoute("admin/provider", async () => {
  await requireAdmin();
  return NextResponse.json(await providerConfigStatus());
});

export const PUT = apiRoute("admin/provider", async (req) => {
  const admin = await requireAdmin();
  const b = UpdateSchema.safeParse(await req.json().catch(() => ({})));
  if (!b.success) throw new HttpError(400, b.error.issues[0].message);
  return NextResponse.json(await updateAiProvider(admin, b.data));
});
