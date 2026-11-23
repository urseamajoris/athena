import { NextResponse } from "next/server";
import { z } from "zod";
import { apiRoute } from "@/lib/http";
import { HttpError } from "@/lib/project";
import { requireAdmin } from "@/lib/auth/server";
import { clearKey, setKey } from "@/lib/admin/actions";
import { keyStatus, providerConfigStatus } from "@/lib/settings";
import { isAiProvider } from "@/lib/shared/ai-providers";

export const dynamic = "force-dynamic";

// The key travels browser → server once, in this request body. It is never logged (apiRoute records the route,
// status and duration only), never stored in plain text, and never sent back: responses carry the masked status.
const Provider = z.enum(["anthropic", "gemini", "xai"]).optional();
const Key = z.object({
  provider: Provider,
  key: z.string().trim().min(16, "That does not look like a valid API key.").max(300).regex(/^\S+$/, "The key cannot contain spaces."),
});

export const GET = apiRoute("admin/key", async (req) => {
  await requireAdmin();
  const p = new URL(req.url).searchParams.get("provider");
  const provider = isAiProvider(p) ? p : undefined;
  return NextResponse.json({ ...(await keyStatus(provider)), providerConfig: await providerConfigStatus() });
});

export const PUT = apiRoute("admin/key", async (req) => {
  const admin = await requireAdmin();
  const b = Key.safeParse(await req.json().catch(() => ({})));
  if (!b.success) throw new HttpError(400, b.error.issues[0].message);
  return NextResponse.json(await setKey(admin, b.data.key, b.data.provider));
});

export const DELETE = apiRoute("admin/key", async (req) => {
  const admin = await requireAdmin();
  const urlProvider = new URL(req.url).searchParams.get("provider");
  const body = await req.json().catch(() => ({})) as { provider?: unknown };
  const raw = isAiProvider(urlProvider) ? urlProvider : isAiProvider(body?.provider) ? body.provider : undefined;
  return NextResponse.json(await clearKey(admin, raw));
});
