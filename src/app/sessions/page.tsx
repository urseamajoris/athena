import type { Metadata } from "next";
import { SessionsList } from "@/components/SessionsList";

export const metadata: Metadata = { title: "Sessions · Athena" };

export default function SessionsPage() {
  return <SessionsList />;
}
