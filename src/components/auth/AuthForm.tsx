"use client";
import { useState } from "react";
import Link from "next/link";
import { AlertCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { api } from "../api";
import { PublicBar } from "../AppChrome";
import { Button } from "../ui";
import { safeNext } from "@/lib/shared/nav";
import { DEFAULT_SIGNUP_CREDITS, formatCredits } from "@/lib/billing/packs";

/** Sign up or log in: one form, one button. */
export function AuthForm({ mode, next, signupOpen = true }: { mode: "login" | "signup"; next?: string; signupOpen?: boolean }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const signup = mode === "signup";
  const target = safeNext(next);
  const other = `${signup ? "/login" : "/signup"}${next ? `?next=${encodeURIComponent(next)}` : ""}`;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (!email.trim() || !password) {
      setError(!email.trim() ? "Enter your email address." : "Enter your password.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ mustChangePassword?: boolean }>(signup ? "/api/auth/signup" : "/api/auth/login", { body: signup ? { email, password, name } : { email, password } });
      router.replace(r?.mustChangePassword ? "/account?reset=1" : target);
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-bg-0">
      <PublicBar />
      <main id="main" className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-4 pb-24 pt-6">
        <h1 className="text-headline font-semibold">{signup ? "Create your account" : "Log in"}</h1>
        <p className="mt-2 text-fg-1">
          {signup ? `Your account starts with ${formatCredits(DEFAULT_SIGNUP_CREDITS)} free credits, and your reviews are private to you.` : "Your reviews are saved to your account."}
        </p>
        <form onSubmit={submit} className="mt-8 space-y-5" noValidate>
          {signup && (
            <div>
              <label htmlFor="name" className="label">Your name <span className="font-normal text-fg-2">(optional)</span></label>
              <input id="name" className="input" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
            </div>
          )}
          <div>
            <label htmlFor="email" className="label">Email</label>
            <input id="email" className="input" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoFocus aria-invalid={!!error || undefined} />
          </div>
          <div>
            <label htmlFor="password" className="label">Password</label>
            <input id="password" className="input" type="password" autoComplete={signup ? "new-password" : "current-password"} required value={password} onChange={(e) => setPassword(e.target.value)} aria-describedby={signup ? "pw-hint" : undefined} aria-invalid={!!error || undefined} />
            {signup && <p id="pw-hint" className="mt-2 text-small text-fg-2">At least 10 characters, not containing the name part of your email.</p>}
          </div>
          {error && (
            <p role="alert" className="flex items-start gap-2 rounded-sm border border-err-line bg-err-soft px-3 py-2 text-fg-0">
              <AlertCircle className="mt-1 h-4 w-4 shrink-0 text-err" strokeWidth={2} aria-hidden />
              {error}
            </p>
          )}
          <Button type="submit" variant="primary" size="lg" className="w-full" busy={busy} awaitInput={!email || !password} aria-disabled={!email || !password || undefined}>
            {signup ? "Create account" : "Log in"}
          </Button>
          {!signup && <p className="text-small text-fg-2">Forgot your password? Ask the person who runs this Athena server to reset it. There is no email reset yet.</p>}
        </form>
        {(signupOpen || signup) && (
          <p className="mt-8 border-t border-line pt-6 text-fg-1">
            {signup ? "Already have an account? " : "New to Athena? "}
            <Link href={other} className="link font-medium">{signup ? "Log in" : "Create an account"}</Link>
          </p>
        )}
      </main>
    </div>
  );
}
