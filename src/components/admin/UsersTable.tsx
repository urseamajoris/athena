"use client";
import { useState } from "react";
import { api, useApi } from "../api";
import { ErrorState, Loading } from "../ui";
import { Modal, MoreMenu } from "../overlays";
import { relTime } from "@/lib/shared/format";

interface Row { id: string; email: string; name: string; role: "user" | "admin"; disabled: boolean; mustChangePassword: boolean; createdAt: string; lastActiveAt: string | null; projects: number; furthestStage: number | null; currentStage: number | null; aiCalls: number; costUsd: number }
type Pending = { row: Row; action: "disable" | "enable" | "delete" | "reset_password" | "make_admin" | "make_user" };

const COPY: Record<Pending["action"], { title: (r: Row) => string; body: (r: Row) => string; button: string; danger?: boolean }> = {
  disable: { title: (r) => `Disable ${r.email}?`, body: () => "They are logged out everywhere and cannot log in until you enable the account again. Their projects are kept.", button: "Disable account", danger: true },
  enable: { title: (r) => `Enable ${r.email}?`, body: () => "They can log in again.", button: "Enable account" },
  delete: { title: (r) => `Delete ${r.email}?`, body: (r) => `The account and all ${r.projects} of its projects are deleted for good.`, button: "Delete account and projects", danger: true },
  reset_password: { title: (r) => `Reset the password of ${r.email}?`, body: () => "They are logged out everywhere. You get a temporary password to give them; they must choose a new one when they log in.", button: "Reset password", danger: true },
  make_admin: { title: (r) => `Make ${r.email} an administrator?`, body: () => "They will see this dashboard and can change AI, the key, the budget and other accounts. Admins still cannot open other people's projects.", button: "Make admin" },
  make_user: { title: (r) => `Remove admin rights from ${r.email}?`, body: () => "They keep their account and projects.", button: "Remove admin rights", danger: true },
};

export function UsersTable({ onChanged }: { onChanged: () => void }) {
  const { data, error, mutate } = useApi<{ users: Row[] }>("/api/admin/users", { refreshInterval: 30_000 });
  const [pending, setPending] = useState<Pending | null>(null);
  const [result, setResult] = useState<{ email: string; temp: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  if (error) return <ErrorState error={error} onRetry={() => mutate()} />;
  if (!data) return <Loading />;
  async function run(p: Pending) {
    setErr(null);
    const body = p.action === "make_admin" ? { action: "set_role", role: "admin" } : p.action === "make_user" ? { action: "set_role", role: "user" } : { action: p.action };
    try {
      const r = await api<{ temporaryPassword?: string }>(`/api/admin/users/${p.row.id}`, { body });
      setPending(null);
      if (r.temporaryPassword) setResult({ email: p.row.email, temp: r.temporaryPassword });
      mutate();
      onChanged();
    } catch (e) {
      setErr((e as Error).message);
    }
  }
  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-left text-12">
          <thead className="text-fg-2"><tr>{["Account", "Role", "Projects", "Furthest step reached", "AI calls", "AI cost", "Last active", "Joined", ""].map((h) => <th key={h} className="py-1 pr-3 font-medium">{h}</th>)}</tr></thead>
          <tbody>
            {data.users.map((u) => (
              <tr key={u.id} className="border-t border-line">
                <th scope="row" className="max-w-56 py-1 pr-3 font-normal">
                  <span className="block truncate text-fg-0">{u.email}</span>
                  {(u.disabled || u.mustChangePassword) && <span className="text-warn">{u.disabled ? "Disabled" : "Must change password"}</span>}
                </th>
                <td className="pr-3">{u.role === "admin" ? "Admin" : "User"}</td>
                <td className="pr-3 tabular-nums">{u.projects}</td>
                <td className="pr-3 tabular-nums">{u.furthestStage === null ? "–" : u.furthestStage === 10 ? "Finished" : `${u.furthestStage} of 9`}{u.currentStage !== null && u.currentStage < u.furthestStage! && <span className="block text-fg-2">now back at step {u.currentStage}</span>}</td>
                <td className="pr-3 tabular-nums">{u.aiCalls}</td>
                <td className="pr-3 tabular-nums">${u.costUsd.toFixed(3)}</td>
                <td className="pr-3" suppressHydrationWarning>{u.lastActiveAt ? relTime(u.lastActiveAt) : "never"}</td>
                <td className="pr-3" suppressHydrationWarning>{relTime(u.createdAt)}</td>
                <td className="py-1">
                  <MoreMenu
                    label={`Actions for ${u.email}`}
                    items={[
                      u.disabled ? { label: "Enable account", onSelect: () => setPending({ row: u, action: "enable" }) } : { label: "Disable account", onSelect: () => setPending({ row: u, action: "disable" }) },
                      { label: "Reset password", onSelect: () => setPending({ row: u, action: "reset_password" }) },
                      u.role === "admin" ? { label: "Remove admin rights", onSelect: () => setPending({ row: u, action: "make_user" }) } : { label: "Make admin", onSelect: () => setPending({ row: u, action: "make_admin" }) },
                      { label: "Delete account", danger: true, onSelect: () => setPending({ row: u, action: "delete" }) },
                    ]}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Modal
        open={!!pending}
        onClose={() => { setPending(null); setErr(null); }}
        title={pending ? COPY[pending.action].title(pending.row) : ""}
        footer={pending && <><button className="btn-secondary" onClick={() => setPending(null)}>Cancel</button><button className={COPY[pending.action].danger ? "btn-danger" : "btn-primary"} onClick={() => run(pending)}>{COPY[pending.action].button}</button></>}
      >
        {pending && <p>{COPY[pending.action].body(pending.row)}</p>}
        {err && <p role="alert" className="mt-3 text-err">{err}</p>}
      </Modal>
      <Modal open={!!result} onClose={() => setResult(null)} title="Temporary password" footer={<button className="btn-primary" onClick={() => setResult(null)}>Done</button>}>
        <p>Give this to {result?.email} through a channel you trust. It is shown only once.</p>
        <p className="mt-3 select-all rounded-sm border border-line-strong bg-bg-2 px-3 py-2 font-mono text-16 text-fg-0">{result?.temp}</p>
      </Modal>
    </>
  );
}
