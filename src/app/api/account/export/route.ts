import { apiRoute } from "@/lib/http";
import { requireUser } from "@/lib/auth/server";
import { exportAccount } from "@/lib/auth/account";

export const dynamic = "force-dynamic";

export const GET = apiRoute("account/export", async () => {
  const data = await exportAccount(await requireUser());
  return new Response(JSON.stringify(data, null, 2), { headers: { "Content-Type": "application/json; charset=utf-8", "Content-Disposition": 'attachment; filename="athena-account.json"' } });
});
