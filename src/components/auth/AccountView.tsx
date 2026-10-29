"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, Download } from "lucide-react";
import { api, useApi } from "../api";
import { ErrorState, Loading, Spinner } from "../ui";
import { Modal } from "../overlays";
import { AppMenu } from "../AppMenu";
import { LogoMark } from "../Logo";

interface Account {
  user: { id: string; email: string; name: string; role: "user" | "admin"; mustChangePassword: boolean; createdAt: string };
  projects: number;
  usage: { calls: number; costUsd: number; tokens: number; byProject: { projectId: string; title: string; createdAt: string; calls: number; cost: number }[] };
}

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={id} className="rounded-md border border-line bg-bg-1 p-4">
      <h2 id={id} className="font-semibold">{title}</h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}

export function AccountView() {
  const { data, error, mutate } = useApi<Account>("/api/account");
  const reset = useSearchParams().get("reset") === "1";
  return (
    <div className="min-h-screen bg-bg-0">
      <header className="flex h-12 items-center justify-between gap-3 border-b border-line px-2 md:px-4">
        <Link href="/sessions" className="btn-ghost h-11"><ArrowLeft className="h-4 w-4" strokeWidth={1.5} aria-hidden /> My projects</Link>
        <Link href="/" className="inline-flex h-11 items-center gap-2 px-1 font-semibold max-sm:hidden" aria-label="Athena home"><LogoMark /></Link>
        <AppMenu />
      </header>
      <main id="main" className="mx-auto max-w-2xl px-4 py-8">
        <h1 className="text-20 font-semibold">Your account</h1>
        {!data && !error && <Loading />}
        {error && <div className="mt-4"><ErrorState error={error} onRetry={() => mutate()} /></div>}
        {data && (
          <div className="mt-6 space-y-4">
            {(reset || data.user.mustChangePassword) && (
              <p role="status" className="rounded-md border border-warn-line bg-warn-soft px-4 py-3 text-fg-0">An administrator reset your password. Choose a new one below before you continue.</p>
            )}
            <Profile data={data} onSaved={() => mutate()} />
            <PasswordForm />
            <Section id="usage-title" title="Your AI usage">
              <p className="mb-2 text-fg-1">Each time Athena asks the AI to read, summarise or draft something for you, that is one call. In demo mode calls are scripted and cost nothing.</p>
              <p className="text-fg-1">
                <span className="tabular-nums text-fg-0">{data.usage.calls}</span> AI call{data.usage.calls === 1 ? "" : "s"} across <span className="tabular-nums text-fg-0">{data.projects}</span> project{data.projects === 1 ? "" : "s"}, costing <span className="tabular-nums text-fg-0">${data.usage.costUsd.toFixed(2)}</span>.
              </p>
              {data.usage.byProject.length > 0 && (
                <table className="mt-3 w-full text-left">
                  <caption className="sr-only">AI usage by project</caption>
                  <thead className="text-12 text-fg-2"><tr><th className="py-1 font-medium">Project</th><th className="py-1 pl-4 text-right font-medium">AI calls</th><th className="py-1 pl-4 text-right font-medium">Cost</th></tr></thead>
                  <tbody>
                    {data.usage.byProject.map((r) => (
                      <tr key={r.projectId} className="border-t border-line">
                        <td className="py-2 pr-2"><Link className="link line-clamp-2" href={`/s/${r.projectId}`}>{r.title || "Untitled"}</Link><span className="block text-12 text-fg-2" suppressHydrationWarning>Started {new Date(r.createdAt).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}</span></td>
                        <td className="py-2 pl-4 text-right align-top tabular-nums">{r.calls}</td>
                        <td className="py-2 pl-4 text-right align-top tabular-nums">${r.cost.toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Section>
            <Section id="export-title" title="Download your data">
              <p className="text-fg-1">One JSON file with your profile, your usage and every project with its full report.</p>
              <a className="btn-secondary mt-3" href="/api/account/export" download><Download className="h-4 w-4" strokeWidth={1.5} aria-hidden /> Download my data</a>
            </Section>
            <DeleteAccount projects={data.projects} />
          </div>
        )}
      </main>
    </div>
  );
}

function Profile({ data, onSaved }: { data: Account; onSaved: () => void }) {
  const [name, setName] = useState(data.user.name);
  const [state, setState] = useState<"idle" | "busy" | "saved">("idle");
  return (
    <Section id="profile-title" title="Profile">
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
        <dt className="text-fg-2">Email</dt><dd className="break-all">{data.user.email}</dd>
        <dt className="text-fg-2">Role</dt><dd>{data.user.role === "admin" ? "Administrator" : "Researcher"}</dd>
      </dl>
      <form
        className="mt-4 flex flex-wrap items-end gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          setState("busy");
          await api("/api/account", { method: "PATCH", body: { name } });
          setState("saved");
          onSaved();
        }}
      >
        <label className="label flex-1">Name<input className="input mt-1 w-full" value={name} maxLength={80} onChange={(e) => { setName(e.target.value); setState("idle"); }} autoComplete="name" /></label>
        <button className="btn-secondary min-h-11" disabled={state === "busy" || name === data.user.name}>Save name</button>
        <span role="status" className="w-full text-12 text-ok">{state === "saved" ? "Saved." : ""}</span>
      </form>
    </Section>
  );
}

function PasswordForm() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Section id="pw-title" title="Change password">
      <form
        className="grid gap-3"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setMsg(null);
          try {
            await api("/api/account/password", { body: { current, next } });
            setMsg({ ok: true, text: "Password changed. Other devices were logged out." });
            setCurrent("");
            setNext("");
          } catch (err) {
            setMsg({ ok: false, text: (err as Error).message });
          }
          setBusy(false);
        }}
      >
        <label className="label">Current password<input className="input mt-1 w-full" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} /></label>
        <label className="label">New password <span className="font-normal text-fg-2">(at least 10 characters)</span><input className="input mt-1 w-full" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} /></label>
        {msg && <p role={msg.ok ? "status" : "alert"} className={msg.ok ? "text-ok" : "text-err"}>{msg.text}</p>}
        <div><button className="btn-secondary min-h-11" disabled={busy || !current || !next}>{busy && <Spinner />}Change password</button></div>
      </form>
    </Section>
  );
}

function DeleteAccount({ projects }: { projects: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <section aria-labelledby="delete-title" className="rounded-md border border-err-line bg-bg-1 p-4">
      <h2 id="delete-title" className="font-semibold">Delete your account</h2>
      <p className="mt-2 text-fg-1">This deletes your account and all {projects} of your projects, with their papers, appraisals, syntheses and decision logs. It cannot be undone. Download your data first if you want a copy.</p>
      <button className="btn-danger mt-3" onClick={() => setOpen(true)}>Delete my account…</button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Delete your account for good?"
        footer={
          <>
            <button className="btn-secondary" onClick={() => setOpen(false)}>Keep my account</button>
            <button
              className="btn-danger"
              disabled={busy || confirm !== "DELETE" || !password}
              onClick={async () => {
                setBusy(true);
                setErr(null);
                try {
                  await api("/api/account", { method: "DELETE", body: { password, confirm } });
                  router.replace("/");
                  router.refresh();
                } catch (e) {
                  setErr((e as Error).message);
                  setBusy(false);
                }
              }}
            >
              Delete account and {projects} project{projects === 1 ? "" : "s"}
            </button>
          </>
        }
      >
        <p>You will lose {projects} project{projects === 1 ? "" : "s"} and everything in them.</p>
        <label className="label mt-4 block">Your password<input className="input mt-1 w-full" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} /></label>
        <label className="label mt-3 block">Type DELETE to confirm<input className="input mt-1 w-full" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="off" /></label>
        {err && <p role="alert" className="mt-3 text-err">{err}</p>}
      </Modal>
    </section>
  );
}
