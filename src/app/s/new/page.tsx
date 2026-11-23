import type { Metadata } from "next";
import { EmptyCanvas } from "@/components/canvas/EmptyCanvas";
import { pageUser } from "@/lib/auth/server";

export const metadata: Metadata = { title: "New session · Athena" };

export const dynamic = "force-dynamic";

export default async function NewSessionPage() {
  await pageUser("/s/new");
  return <EmptyCanvas />;
}
