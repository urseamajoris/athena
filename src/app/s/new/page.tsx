import type { Metadata } from "next";
import { EmptyCanvas } from "@/components/canvas/EmptyCanvas";

export const metadata: Metadata = { title: "New session · Athena" };

export default function NewSessionPage() {
  return <EmptyCanvas />;
}
