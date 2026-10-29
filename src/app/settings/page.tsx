import type { Metadata } from "next";
import { SWRConfig } from "swr";
import { SettingsView } from "@/components/SettingsView";
import { plain, projectsList, statusView } from "@/lib/preload";
import { pageUser } from "@/lib/auth/server";

export const metadata: Metadata = { title: "Settings · Athena" };
export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const user = await pageUser("/settings");
  return (
    <SWRConfig value={{ fallback: { "/api/status": plain(await statusView(user)), "/api/projects": plain(await projectsList(user.id)) } }}>
      <SettingsView />
    </SWRConfig>
  );
}
