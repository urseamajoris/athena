import "server-only";
import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { db, schema } from "../db";
import { HttpError } from "../project";
import { markdownReport } from "../export";
import { newId } from "../util";
import { hashPassword, passwordProblem, verifyPassword } from "./password";
import { LOGIN_WINDOW_MIN, hashId, normEmail, loginRetryAfter } from "./policy";
import { audit, clientIp, endOtherSessions, endSession, recentFailures, startSession, type SessionUser } from "./server";

export const signupOpen = () => !["0", "false", "no", "off"].includes((process.env.ALLOW_SIGNUP ?? "").trim().toLowerCase());

export async function signUp(input: { email: string; password: string; name?: string }) {
  if (!signupOpen()) throw new HttpError(403, "Sign-up is closed on this server. Ask the administrator for an account.");
  const email = normEmail(input.email);
  // The administrator's address is reserved: whoever signed up with it first would otherwise own it.
  if (process.env.ADMIN_EMAIL && normEmail(process.env.ADMIN_EMAIL) === email) throw new HttpError(403, "This email is reserved for the administrator of this server.");
  const ip = await clientIp();
  const since = new Date(Date.now() - 3600_000).toISOString();
  const recent = await db.select({ n: sql<number>`count(*)` }).from(schema.auditEvents).where(and(eq(schema.auditEvents.action, "signup"), eq(schema.auditEvents.ipHash, hashId(ip)), sql`${schema.auditEvents.createdAt} > ${since}`)).get();
  if ((recent?.n ?? 0) >= 10) throw new HttpError(429, "Too many new accounts from this network. Try again in an hour.");
  const problem = passwordProblem(input.password, email);
  if (problem) throw new HttpError(400, problem);
  if (await db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.email, email)).get()) {
    throw new HttpError(409, "An account with this email already exists. Log in instead.");
  }
  const id = newId("usr");
  await db.insert(schema.users).values({ id, email, name: input.name?.trim() ?? "", passwordHash: await hashPassword(input.password), role: "user" }).run();
  await audit("security", "signup", { actorId: id, targetId: id, email, ip });
  await startSession(id);
  return { id };
}

export async function logIn(input: { email: string; password: string }) {
  const email = normEmail(input.email);
  const ip = await clientIp();
  const since = new Date(Date.now() - LOGIN_WINDOW_MIN * 60_000).toISOString();
  const wait = loginRetryAfter(await recentFailures(email, ip, since), Date.now());
  if (wait > 0) {
    await audit("security", "login_rate_limited", { email, ip });
    throw Object.assign(new HttpError(429, `Too many failed attempts. Try again in ${Math.ceil(wait / 60)} minute${wait > 60 ? "s" : ""}.`), { retryAfter: wait });
  }
  const u = await db.select().from(schema.users).where(eq(schema.users.email, email)).get();
  // The same work and the same message whether or not the account exists.
  const ok = u ? await verifyPassword(input.password, u.passwordHash) : (await hashPassword(input.password), false);
  if (!u || !ok) {
    await audit("security", "login_failed", { email, ip, targetId: u?.id ?? null });
    throw new HttpError(401, "That email and password do not match an account.");
  }
  if (u.disabled) {
    await audit("security", "login_refused_disabled", { email, ip, targetId: u.id });
    throw new HttpError(403, "This account is disabled. Contact the administrator.");
  }
  await audit("security", "login_ok", { actorId: u.id, targetId: u.id, ip });
  await startSession(u.id);
  return { mustChangePassword: u.mustChangePassword };
}

export async function logOut(user: SessionUser | null) {
  await endSession();
  if (user) await audit("security", "logout", { actorId: user.id, targetId: user.id });
}

export async function changePassword(user: SessionUser, current: string, next: string) {
  const u = await db.select().from(schema.users).where(eq(schema.users.id, user.id)).get();
  if (!u || !(await verifyPassword(current, u.passwordHash))) {
    await audit("security", "password_change_failed", { actorId: user.id, targetId: user.id, ip: await clientIp() });
    throw new HttpError(400, "Your current password is not right.");
  }
  const problem = passwordProblem(next, u.email);
  if (problem) throw new HttpError(400, problem);
  if (await verifyPassword(next, u.passwordHash)) throw new HttpError(400, "Choose a password different from the current one.");
  await db.update(schema.users).set({ passwordHash: await hashPassword(next), mustChangePassword: false }).where(eq(schema.users.id, u.id)).run();
  await endOtherSessions(u.id, true);
  await audit("security", "password_changed", { actorId: u.id, targetId: u.id });
}

/** This user's own AI usage: calls and cost across their projects. */
export async function usageFor(userId: string) {
  const rows = await db
    .select({
      projectId: schema.aiCalls.projectId,
      title: schema.projects.title,
      createdAt: schema.projects.createdAt,
      calls: sql<number>`count(*)`,
      cost: sql<number>`coalesce(sum(${schema.aiCalls.costUsd}),0)`,
      tokens: sql<number>`coalesce(sum(${schema.aiCalls.inputTokens} + ${schema.aiCalls.outputTokens}),0)`,
    })
    .from(schema.aiCalls)
    .innerJoin(schema.projects, eq(schema.projects.id, schema.aiCalls.projectId))
    .where(eq(schema.projects.ownerId, userId))
    .groupBy(schema.aiCalls.projectId)
    .orderBy(desc(sql`sum(${schema.aiCalls.costUsd})`))
    .all();
  return {
    calls: rows.reduce((a, r) => a + r.calls, 0),
    costUsd: rows.reduce((a, r) => a + r.cost, 0),
    tokens: rows.reduce((a, r) => a + r.tokens, 0),
    byProject: rows,
  };
}

export async function accountView(user: SessionUser) {
  const projects = await db.select({ n: sql<number>`count(*)` }).from(schema.projects).where(eq(schema.projects.ownerId, user.id)).get();
  return { user, projects: projects?.n ?? 0, usage: await usageFor(user.id) };
}

/** Everything this user owns, as JSON: profile, projects, each project's report. Never the password hash. */
export async function exportAccount(user: SessionUser) {
  const projects = await db.select().from(schema.projects).where(eq(schema.projects.ownerId, user.id)).all();
  const out = [];
  for (const p of projects) {
    out.push({
      id: p.id,
      title: p.title,
      idea: p.idea,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
      stageStates: p.stageStates,
      reportMarkdown: await markdownReport(p.id),
    });
  }
  await audit("security", "account_exported", { actorId: user.id, targetId: user.id });
  return { exportedAt: new Date().toISOString(), profile: { email: user.email, name: user.name, role: user.role, createdAt: user.createdAt }, usage: await usageFor(user.id), projects: out };
}

/** Deletes the user, their projects (and everything in them) and their sessions. */
export async function deleteUserAndData(userId: string) {
  const u = await db.select().from(schema.users).where(eq(schema.users.id, userId)).get();
  if (!u) throw new HttpError(404, "Account not found");
  if (u.role === "admin") {
    const others = await db.select({ id: schema.users.id }).from(schema.users).where(and(eq(schema.users.role, "admin"), ne(schema.users.id, userId), eq(schema.users.disabled, false))).all();
    if (!others.length) throw new HttpError(409, "This is the only active administrator. Make someone else an admin first.");
  }
  const ids = (await db.select({ id: schema.projects.id }).from(schema.projects).where(eq(schema.projects.ownerId, userId)).all()).map((r) => r.id);
  if (ids.length) await db.delete(schema.projects).where(inArray(schema.projects.id, ids)).run();
  await db.delete(schema.users).where(eq(schema.users.id, userId)).run();
  return { projectsDeleted: ids.length };
}

export async function deleteOwnAccount(user: SessionUser, password: string) {
  const u = await db.select().from(schema.users).where(eq(schema.users.id, user.id)).get();
  if (!u || !(await verifyPassword(password, u.passwordHash))) throw new HttpError(400, "Your password is not right.");
  const r = await deleteUserAndData(user.id);
  await endSession();
  await audit("security", "account_deleted", { targetId: user.id, detail: { projectsDeleted: r.projectsDeleted } });
  return r;
}
