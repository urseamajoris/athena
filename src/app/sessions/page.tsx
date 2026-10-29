import type { Metadata } from "next";
import { SWRConfig } from "swr";
import { SessionsList } from "@/components/SessionsList";
import { plain, projectsList } from "@/lib/preload";
import { pageUser } from "@/lib/auth/server";

export const metadata: Metadata = { title: "Sessions · Athena" };
export const dynamic = "force-dynamic";

export default async function SessionsPage() {
  const user = await pageUser("/sessions");
  return (
    <SWRConfig value={{ fallback: { "/api/projects": plain(await projectsList(user.id)) } }}>
      <SessionsList admin={user.role === "admin"} />
    </SWRConfig>
  );
}
