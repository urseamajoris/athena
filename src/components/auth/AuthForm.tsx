"use client";
import { useState } from "react";
import Link from "next/link";
import { AlertCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { api } from "../api";
import { LogoMark } from "../Logo";
import { Spinner } from "../ui";
import { safeNext } from "@/lib/shared/nav";


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
      <header className="mx-auto flex h-12 w-full max-w-6xl items-center px-4">
        <Link href="/" className="inline-flex h-11 items-center gap-2 rounded-sm px-1 font-semibold"><LogoMark /> Athena</Link>
      </header>
      <main id="main" className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-4 pb-24">
        <h1 className="text-28 font-semibold">{signup ? "Create your account" : "Log in to continue your review"}</h1>
        <p className="mt-2 text-fg-1">{signup ? "Athena guides you from a rough idea to a research question grounded in real papers, in 9 steps. Your reviews are private to your account." : "Your literature reviews are saved to your account."}</p>
        <form onSubmit={submit} className="mt-8 space-y-6" noValidate>
          {signup && (
            <label className="label block">
              Your name <span className="font-normal text-fg-2">(optional)</span>
              <input className="input mt-1 w-full" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
            </label>
          )}
          <label className="label block">
            Email
            <input className="input mt-1 w-full" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoFocus aria-invalid={!!error || undefined} />
          </label>
          <label className="label block">
            Password
            <input className="input mt-1 w-full" type="password" autoComplete={signup ? "new-password" : "current-password"} required value={password} onChange={(e) => setPassword(e.target.value)} aria-describedby={signup ? "pw-hint" : undefined} aria-invalid={!!error || undefined} />
          </label>
          {signup && <p id="pw-hint" className="-mt-5 text-12 text-fg-2">At least 10 characters, not containing the name part of your email.</p>}
          {error && <p role="alert" className="flex items-start gap-2 rounded-sm border border-err-line px-3 py-2 text-fg-0"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-err" strokeWidth={2} aria-hidden />{error}</p>}
          <button className="btn-primary min-h-11 w-full text-16" data-await-input aria-disabled={busy || !email || !password || undefined}>
            {busy && <Spinner label={signup ? "Creating your account" : "Logging in"} />}
            {signup ? "Create account" : "Log in"}
          </button>
          {!signup && <p className="text-12 text-fg-2">Forgot your password? Ask the person who runs this Athena server to reset it; there is no email reset yet.</p>}
        </form>
        {(signupOpen || signup) && (
          <p className="mt-6 text-fg-1">
            {signup ? "Already have an account? " : "New to Athena? "}
            <Link href={other} className="link">{signup ? "Log in" : "Create an account"}</Link>
          </p>
        )}
      </main>
    </div>
  );
}
