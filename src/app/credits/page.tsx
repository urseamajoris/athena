import type { Metadata } from "next";
import { SWRConfig } from "swr";
import { CreditsView } from "@/components/credits/CreditsView";
import { pageUser } from "@/lib/auth/server";
import { creditsView } from "@/lib/credits";
import { plain } from "@/lib/preload";

export const metadata: Metadata = { title: "Credits & Top Up · Athena" };
export const dynamic = "force-dynamic";

export default async function CreditsPage() {
  const user = await pageUser("/credits");
  return (
    <SWRConfig value={{ fallback: { "/api/credits": plain(await creditsView(user)) } }}>
      <CreditsView />
    </SWRConfig>
  );
}
