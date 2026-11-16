import type { Metadata } from "next";
import { NewReview } from "@/components/steps/NewReview";
import { pageUser } from "@/lib/auth/server";

export const metadata: Metadata = { title: "New review · Athena" };
export const dynamic = "force-dynamic";

export default async function NewReviewPage() {
  await pageUser("/s/new");
  return <NewReview />;
}
