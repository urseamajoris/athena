import type { Metadata } from "next";
import { CreditsPlaceholder } from "@/components/CreditsPlaceholder";
import { pageUser } from "@/lib/auth/server";

export const metadata: Metadata = { title: "Credits · Athena" };
export const dynamic = "force-dynamic";

export default async function CreditsPage() {
  await pageUser("/credits");
  return <CreditsPlaceholder />;
}
