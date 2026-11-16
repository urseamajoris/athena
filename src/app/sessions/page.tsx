import type { Metadata } from "next";
import { SWRConfig } from "swr";
import { ReviewsList } from "@/components/ReviewsList";
import { plain, projectsList } from "@/lib/preload";
import { pageUser } from "@/lib/auth/server";

export const metadata: Metadata = { title: "My reviews · Athena" };
export const dynamic = "force-dynamic";

export default async function ReviewsPage() {
  const user = await pageUser("/sessions");
  return (
    <SWRConfig value={{ fallback: { "/api/projects": plain(await projectsList(user.id)) } }}>
      <ReviewsList />
    </SWRConfig>
  );
}
