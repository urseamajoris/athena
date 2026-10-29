import type { Metadata } from "next";
import { SWRConfig } from "swr";
import { SettingsView } from "@/components/SettingsView";
import { plain, projectsList, statusView } from "@/lib/preload";

export const metadata: Metadata = { title: "Settings · Athena" };
export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  return (
    <SWRConfig value={{ fallback: { "/api/status": plain(await statusView()), "/api/projects": plain((await projectsList())) } }}>
      <SettingsView />
    </SWRConfig>
  );
}
