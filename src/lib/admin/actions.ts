import "server-only";
import { randomBytes } from "node:crypto";
import { and, eq, ne } from "drizzle-orm";
import { db, schema } from "../db";
import { HttpError } from "../project";
import { hashPassword } from "../auth/password";
import { audit, endOtherSessions, type SessionUser } from "../auth/server";
import { deleteUserAndData } from "../auth/account";
import { fingerprint } from "../auth/secrets";
import { config } from "../config";
import { testKey } from "../ai/models";
import { aiSwitch, budgetSetting, clearBudget, clearXaiKey, keyStatus, recordKeyTest, saveXaiKey, setAiEnabled, setBudget, SettingsError } from "../settings";
import { resumePausedJobs } from "../jobs";

async function target(id: string) {
  const u = await db.select().from(schema.users).where(eq(schema.users.id, id)).get();
  if (!u) throw new HttpError(404, "Account not found");
  return u;
}

async function otherActiveAdmins(id: string) {
  return (await db.select({ id: schema.users.id }).from(schema.users).where(and(eq(schema.users.role, "admin"), eq(schema.users.disabled, false), ne(schema.users.id, id))).all()).length;
}

export type UserAction = { action: "disable" } | { action: "enable" } | { action: "delete" } | { action: "reset_password" } | { action: "set_role"; role: "user" | "admin" };

export async function userAction(admin: SessionUser, id: string, a: UserAction) {
  const u = await target(id);
  const log = (action: string, detail?: Record<string, unknown>) => audit("admin", action, { actorId: admin.id, targetId: u.id, detail });
  switch (a.action) {
    case "disable": {
      if (u.id === admin.id) throw new HttpError(409, "You cannot disable your own account.");
      if (u.role === "admin" && !(await otherActiveAdmins(u.id))) throw new HttpError(409, "This is the only active administrator.");
      await db.update(schema.users).set({ disabled: true }).where(eq(schema.users.id, u.id)).run();
      await endOtherSessions(u.id, false);
      await log("user_disabled");
      return { ok: true };
    }
    case "enable":
      await db.update(schema.users).set({ disabled: false }).where(eq(schema.users.id, u.id)).run();
      await log("user_enabled");
      return { ok: true };
    case "delete": {
      if (u.id === admin.id) throw new HttpError(409, "Delete your own account from the Account page.");
      const r = await deleteUserAndData(u.id);
      await audit("admin", "user_deleted", { actorId: admin.id, detail: { projectsDeleted: r.projectsDeleted, email: u.email.replace(/^(.).*@/, "$1•••@") } });
      return { ok: true, ...r };
    }
    case "reset_password": {
      // A one-time temporary password, shown to the admin once; the user must choose a new one at next login.
      const temp = randomBytes(12).toString("base64url");
      await db.update(schema.users).set({ passwordHash: await hashPassword(temp), mustChangePassword: true }).where(eq(schema.users.id, u.id)).run();
      await endOtherSessions(u.id, false);
      await log("password_reset");
      return { ok: true, temporaryPassword: temp };
    }
    case "set_role": {
      if (u.role === a.role) return { ok: true };
      if (u.id === admin.id && a.role !== "admin") throw new HttpError(409, "You cannot remove your own admin role.");
      if (u.role === "admin" && a.role !== "admin" && !(await otherActiveAdmins(u.id))) throw new HttpError(409, "This is the only active administrator.");
      await db.update(schema.users).set({ role: a.role }).where(eq(schema.users.id, u.id)).run();
      await audit("security", "role_changed", { actorId: admin.id, targetId: u.id, detail: { from: u.role, to: a.role } });
      return { ok: true };
    }
  }
}

export async function setAi(admin: SessionUser, enabled: boolean) {
  const before = await aiSwitch();
  await setAiEnabled(enabled, admin.id);
  await audit("admin", enabled ? "ai_enabled" : "ai_disabled", { actorId: admin.id, detail: { was: before.enabled ? "on" : "off" } });
  const resumed = enabled ? await resumePausedJobs() : 0;
  return { ...(await aiSwitch()), resumedJobs: resumed };
}

export async function setKey(admin: SessionUser, key: string) {
  try {
    const { fingerprint: fp } = await saveXaiKey(key, admin.id);
    await audit("admin", "xai_key_set", { actorId: admin.id, detail: { fingerprint: fp } });
  } catch (e) {
    if (e instanceof SettingsError) throw new HttpError(409, e.message);
    throw e;
  }
  return keyStatus();
}

export async function clearKey(admin: SessionUser) {
  await clearXaiKey();
  await audit("admin", "xai_key_cleared", { actorId: admin.id, detail: { fallback: config.xaiApiKey ? "environment" : "none", envFingerprint: config.xaiApiKey ? fingerprint(config.xaiApiKey) : null } });
  return keyStatus();
}

export async function runKeyTest(admin: SessionUser) {
  const r = await testKey();
  await recordKeyTest({ ...r, at: new Date().toISOString() }, admin.id);
  await audit("admin", "xai_key_tested", { actorId: admin.id, detail: { ok: r.ok, source: r.source } });
  return keyStatus();
}

export async function changeBudget(admin: SessionUser, limitUsd: number | null, confirmAboveEnv: boolean) {
  const before = await budgetSetting();
  if (limitUsd === null) {
    await clearBudget();
  } else {
    if (limitUsd > before.envUsd && !confirmAboveEnv) {
      throw Object.assign(new HttpError(409, `$${limitUsd.toFixed(2)} is above the server's limit of $${before.envUsd.toFixed(2)} (XAI_BUDGET_USD). Confirm to raise it.`), { kind: "confirm_needed" });
    }
    await setBudget(limitUsd, admin.id);
  }
  const after = await budgetSetting();
  await audit("admin", "budget_changed", { actorId: admin.id, detail: { from: before.limitUsd, to: after.limitUsd, envUsd: after.envUsd, aboveEnv: after.limitUsd > after.envUsd } });
  const resumed = after.limitUsd > before.limitUsd ? await resumePausedJobs() : 0;
  return { ...after, resumedJobs: resumed };
}
