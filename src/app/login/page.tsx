import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthForm } from "@/components/auth/AuthForm";
import { safeNext } from "@/lib/shared/nav";
import { currentUser } from "@/lib/auth/server";
import { signupOpen } from "@/lib/auth/account";

export const metadata: Metadata = { title: "Log in · Athena" };
export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  if (await currentUser()) redirect(safeNext(next));
  return <AuthForm mode="login" next={next} signupOpen={signupOpen()} />;
}
