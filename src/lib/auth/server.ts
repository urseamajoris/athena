import "server-only";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { randomBytes, createHash } from "node:crypto";
import { and, asc, eq, isNull, gt, sql } from "drizzle-orm";
import { db, schema } from "../db";
import { HttpError } from "../project";
import { newId, nowIso } from "../util";
import { hashPassword, passwordProblem } from "./password";
import { SESSION_COOKIE, SESSION_DAYS, hashId, maskEmail, normEmail, sameOrigin } from "./policy";
import type { Role } from "../db/schema";

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  mustChangePassword: boolean;
  createdAt: string;
}

const tokenId = (token: string) => createHash("sha256").update(token).digest("hex");
const TOUCH_MS = 5 * 60_000;

/** The signed-in user for this request (memoised per request), or null. */
export const currentUser = cache(async (): Promise<SessionUser | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token || token.length > 200) return null;
  const row = await db
    .select({ s: schema.sessions, u: schema.users })
    .from(schema.sessions)
    .innerJoin(schema.users, eq(schema.users.id, schema.sessions.userId))
    .where(eq(schema.sessions.id, tokenId(token)))
    .get();
  if (!row || row.u.disabled || row.s.expiresAt < nowIso()) return null;
  // Activity is recorded at most every few minutes (it feeds "active users" on the admin dashboard).
  if (Date.now() - Date.parse(row.s.lastSeenAt) > TOUCH_MS) {
    const now = nowIso();
    await db.update(schema.sessions).set({ lastSeenAt: now }).where(eq(schema.sessions.id, row.s.id)).run();
    await db.update(schema.users).set({ lastActiveAt: now }).where(eq(schema.users.id, row.u.id)).run();
  }
  return { id: row.u.id, email: row.u.email, name: row.u.name, role: row.u.role, mustChangePassword: row.u.mustChangePassword, createdAt: row.u.createdAt };
});

/** API: 401 unless signed in. */
export async function requireUser(): Promise<SessionUser> {
  const u = await currentUser();
  if (!u) throw new HttpError(401, "Log in to continue.");
  return u;
}

/** API: 401 anonymous, 403 for anyone who is not an admin. */
export async function requireAdmin(): Promise<SessionUser> {
  const u = await requireUser();
  if (u.role !== "admin") throw new HttpError(403, "Only an administrator can do this.");
  return u;
}

/** Pages: send anonymous visitors to the login page, then back here. */
export async function pageUser(next: string): Promise<SessionUser> {
  const u = await currentUser();
  if (!u) redirect(`/login?next=${encodeURIComponent(next)}`);
  return u;
}

export async function pageAdmin(next: string): Promise<SessionUser> {
  const u = await pageUser(next);
  if (u.role !== "admin") redirect("/sessions");
  return u;
}

/** Reject cross-site state-changing requests (SameSite=Lax already blocks most; this covers the rest). */
export async function assertSameOrigin(req: Request) {
  if (req.method === "GET" || req.method === "HEAD") return;
  const h = await headers();
  if (!sameOrigin(h.get("origin"), h.get("x-forwarded-host") ?? h.get("host"))) throw new HttpError(403, "Cross-site request refused.");
}

export async function clientIp(): Promise<string> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0].trim() || h.get("x-real-ip") || "local";
}

async function secureCookie(): Promise<boolean> {
  const h = await headers();
  return (h.get("x-forwarded-proto") ?? "").split(",")[0].trim() === "https";
}

export async function startSession(userId: string) {
  const token = randomBytes(32).toString("base64url");
  const now = nowIso();
  const expires = new Date(Date.now() + SESSION_DAYS * 86_400_000);
  await db.insert(schema.sessions).values({ id: tokenId(token), userId, createdAt: now, lastSeenAt: now, expiresAt: expires.toISOString() }).run();
  await db.update(schema.users).set({ lastLoginAt: now, lastActiveAt: now }).where(eq(schema.users.id, userId)).run();
  (await cookies()).set(SESSION_COOKIE, token, { httpOnly: true, sameSite: "lax", secure: await secureCookie(), path: "/", expires });
  // Housekeeping: expired sessions are removed whenever someone logs in.
  await db.delete(schema.sessions).where(sql`${schema.sessions.expiresAt} < ${now}`).run();
}

export async function endSession() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await db.delete(schema.sessions).where(eq(schema.sessions.id, tokenId(token))).run();
  jar.delete(SESSION_COOKIE);
}

/** Ends every session of a user except, optionally, the current one. */
export async function endOtherSessions(userId: string, keepCurrent: boolean) {
  const token = keepCurrent ? (await cookies()).get(SESSION_COOKIE)?.value : undefined;
  const rows = await db.select({ id: schema.sessions.id }).from(schema.sessions).where(eq(schema.sessions.userId, userId)).all();
  for (const r of rows) if (!token || r.id !== tokenId(token)) await db.delete(schema.sessions).where(eq(schema.sessions.id, r.id)).run();
}

export async function audit(
  category: "security" | "admin",
  action: string,
  opts: { actorId?: string | null; targetId?: string | null; email?: string | null; ip?: string | null; detail?: Record<string, unknown> | null } = {},
) {
  await db
    .insert(schema.auditEvents)
    .values({
      id: newId("ev"),
      category,
      action,
      actorId: opts.actorId ?? null,
      targetId: opts.targetId ?? null,
      emailHash: opts.email ? hashId(normEmail(opts.email)) : null,
      ipHash: opts.ip ? hashId(opts.ip) : null,
      detail: { ...(opts.email ? { email: maskEmail(opts.email) } : {}), ...(opts.detail ?? {}) },
    })
    .run();
}

/** The project if it belongs to this user; otherwise 404 (never reveals that another user's project exists). */
export async function ownedProject(projectId: string, user: SessionUser) {
  const p = await db.select().from(schema.projects).where(and(eq(schema.projects.id, projectId), eq(schema.projects.ownerId, user.id))).get();
  if (!p) throw new HttpError(404, "Project not found");
  return p;
}

/**
 * Startup: create the first admin from ADMIN_EMAIL / ADMIN_PASSWORD if that account does not exist yet
 * (an existing account is promoted to admin; its password is left alone, so a password changed in the app
 * is not overwritten on the next cold start). Projects created before accounts existed are then assigned
 * to the first admin.
 */
export async function ensureAdminFromEnv(): Promise<string | null> {
  const email = process.env.ADMIN_EMAIL ? normEmail(process.env.ADMIN_EMAIL) : "";
  const password = process.env.ADMIN_PASSWORD ?? "";
  if (email) {
    const existing = await db.select().from(schema.users).where(eq(schema.users.email, email)).get();
    if (!existing) {
      const problem = passwordProblem(password, email);
      if (problem) console.error(`[athena] ADMIN_PASSWORD rejected (${problem}); no admin account was created.`);
      else {
        const id = newId("usr");
        await db.insert(schema.users).values({ id, email, name: "Administrator", passwordHash: await hashPassword(password), role: "admin" }).run();
        await audit("security", "admin_bootstrapped", { targetId: id, email });
        console.log(`[athena] created the admin account ${maskEmail(email)} from ADMIN_EMAIL.`);
      }
    } else if (existing.role !== "admin") {
      await db.update(schema.users).set({ role: "admin" }).where(eq(schema.users.id, existing.id)).run();
      await audit("security", "role_changed", { targetId: existing.id, email, detail: { from: existing.role, to: "admin", by: "ADMIN_EMAIL at startup" } });
    }
  }
  const admin = await db.select().from(schema.users).where(eq(schema.users.role, "admin")).orderBy(asc(schema.users.createdAt)).get();
  const orphans = await db.select({ id: schema.projects.id }).from(schema.projects).where(isNull(schema.projects.ownerId)).all();
  if (orphans.length) {
    if (admin) {
      await db.update(schema.projects).set({ ownerId: admin.id }).where(isNull(schema.projects.ownerId)).run();
      await audit("security", "orphan_projects_assigned", { targetId: admin.id, detail: { projects: orphans.length } });
      console.log(`[athena] assigned ${orphans.length} project(s) without an owner to the first admin.`);
    } else {
      console.warn(`[athena] ${orphans.length} project(s) have no owner and no admin exists to receive them. Set ADMIN_EMAIL and ADMIN_PASSWORD.`);
    }
  }
  if (!admin) console.warn("[athena] no admin account exists. Set ADMIN_EMAIL and ADMIN_PASSWORD to create one.");
  return admin?.id ?? null;
}

/** Recent failed logins for rate limiting. */
export async function recentFailures(email: string, ip: string, sinceIso: string) {
  const q = (col: typeof schema.auditEvents.emailHash | typeof schema.auditEvents.ipHash, v: string) =>
    db
      .select({ t: schema.auditEvents.createdAt })
      .from(schema.auditEvents)
      .where(and(eq(schema.auditEvents.action, "login_failed"), eq(col, v), gt(schema.auditEvents.createdAt, sinceIso)))
      .all();
  const [e, i] = await Promise.all([q(schema.auditEvents.emailHash, hashId(normEmail(email))), q(schema.auditEvents.ipHash, hashId(ip))]);
  return { email: e.map((r) => r.t), ip: i.map((r) => r.t) };
}
