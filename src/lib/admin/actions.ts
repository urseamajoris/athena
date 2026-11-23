import "server-only";
import { randomBytes } from "node:crypto";
import { and, eq, ne } from "drizzle-orm";
import { db, schema } from "../db";
import { HttpError } from "../project";
import { hashPassword } from "../auth/password";
import { audit, endOtherSessions, type SessionUser } from "../auth/server";
import { deleteUserAndData } from "../auth/account";
import { fingerprint } from "../auth/secrets";
import { config, envKeyFor, type AiProvider, type ModelRole } from "../config";
import { resetModelCache, testProviderKey } from "../ai/models";
import { activeProvider, aiEnabled, aiSwitch, budgetSetting, clearBudget, clearProviderKey, effectiveProviderKey, keyStatus, providerConfigStatus, recordProviderKeyTest, saveProviderKey, setActiveProvider, setAiEnabled, setBudget, setProviderModels, SettingsError } from "../settings";
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

export async function setKey(admin: SessionUser, key: string, provider?: AiProvider) {
  const p = provider ?? (await activeProvider());
  const curProvider = await activeProvider();
  const hadKey = !!(await effectiveProviderKey(curProvider)).key;
  try {
    const { fingerprint: fp } = await saveProviderKey(p, key, admin.id);
    await audit("admin", `${p}_key_set`, { actorId: admin.id, detail: { provider: p, fingerprint: fp } });
  } catch (e) {
    if (e instanceof SettingsError) throw new HttpError(409, e.message);
    throw e;
  }
  resetModelCache();
  // Jobs paused for want of a key pick up again if the active provider now has a key.
  const nowHasKey = !!(await effectiveProviderKey(curProvider)).key;
  const resumed = !hadKey && nowHasKey && (await aiEnabled()) ? await resumePausedJobs() : 0;
  return { ...(await keyStatus(p)), providerConfig: await providerConfigStatus(), resumedJobs: resumed };
}

export async function clearKey(admin: SessionUser, provider?: AiProvider) {
  const p = provider ?? (await activeProvider());
  await clearProviderKey(p);
  resetModelCache();
  const envKey = envKeyFor(p);
  await audit("admin", `${p}_key_cleared`, { actorId: admin.id, detail: { provider: p, fallback: envKey ? "environment" : "none", envFingerprint: envKey ? fingerprint(envKey) : null } });
  return { ...(await keyStatus(p)), providerConfig: await providerConfigStatus() };
}

export async function runKeyTest(admin: SessionUser, provider?: AiProvider) {
  const p = provider ?? (await activeProvider());
  const r = await testProviderKey(p);
  await recordProviderKeyTest(p, { ...r, at: new Date().toISOString() }, admin.id);
  await audit("admin", `${p}_key_tested`, { actorId: admin.id, detail: { provider: p, ok: r.ok, source: r.source } });
  return { ...(await keyStatus(p)), providerConfig: await providerConfigStatus() };
}

export async function updateAiProvider(
  admin: SessionUser,
  patch: { provider?: AiProvider; model?: string | null; models?: Partial<Record<ModelRole, string | null>> },
) {
  const beforeProvider = await activeProvider();
  const hadKey = !!(await effectiveProviderKey(beforeProvider)).key;
  const targetProvider = patch.provider ?? beforeProvider;
  if (patch.provider && patch.provider !== beforeProvider) {
    await setActiveProvider(patch.provider, admin.id);
    await audit("admin", "ai_provider_changed", { actorId: admin.id, detail: { from: beforeProvider, to: patch.provider } });
  }
  if (patch.model !== undefined) {
    const val = patch.model === null ? null : patch.model.trim() || null;
    await setProviderModels(targetProvider, { fast: val, summary: val, reasoning: val }, admin.id);
    await audit("admin", "ai_models_changed", { actorId: admin.id, detail: { provider: targetProvider, model: val ?? "default" } });
  } else if (patch.models && Object.keys(patch.models).length > 0) {
    await setProviderModels(targetProvider, patch.models, admin.id);
    await audit("admin", "ai_models_changed", { actorId: admin.id, detail: { provider: targetProvider, models: patch.models } });
  }
  resetModelCache();
  const nowHasKey = !!(await effectiveProviderKey(targetProvider)).key;
  const resumed = !hadKey && nowHasKey && (await aiEnabled()) ? await resumePausedJobs() : 0;
  return { ...(await providerConfigStatus()), resumedJobs: resumed };
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
