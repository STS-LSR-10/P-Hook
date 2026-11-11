import type { SupabaseClient } from "@supabase/supabase-js";
import { apiError } from "@/lib/api";
import type { MemoryLite } from "@/lib/categorize/rules";
import { can, effectivePlan, MIN_PLAN, PLAN_LABEL, type Feature, type Plan } from "@/lib/plan";
import { loadMemory } from "@/lib/repo";
import { getUserPlanRow } from "@/lib/slip-repo";

export interface PlanInfo {
  /** The plan in force right now (expiry applied). */
  plan: Plan;
  expiresAt: string | null;
}

export async function getPlanInfo(
  db: SupabaseClient,
  userId: string,
  now: Date = new Date(),
): Promise<PlanInfo> {
  const row = await getUserPlanRow(db, userId);
  return {
    plan: effectivePlan(row.plan, row.plan_expires_at, now),
    expiresAt: row.plan_expires_at,
  };
}

export const PLUS_ONLY_MESSAGE =
  "ฟีเจอร์นี้สำหรับแผน Starter ขึ้นไป ใช้ฮูกคอยน์แลกวัน Pro ได้ที่หน้าตั้งค่านะ";

/** The locked message names the plan this feature really starts at. */
export const lockedMessage = (feature: Feature): string =>
  MIN_PLAN[feature] === "starter"
    ? PLUS_ONLY_MESSAGE
    : `ฟีเจอร์นี้สำหรับแผน ${PLAN_LABEL[MIN_PLAN[feature]]} ขึ้นไป ใช้ฮูกคอยน์แลกวัน Pro ได้ที่หน้าตั้งค่านะ`;

/**
 * Server-side feature gate for API routes (the UI hides things too, but this is the real check).
 * Returns a 403 Response when the user's plan lacks the feature, otherwise null.
 */
export async function requireFeature(
  db: SupabaseClient,
  userId: string,
  feature: Feature,
): Promise<Response | null> {
  const { plan } = await getPlanInfo(db, userId);
  if (can(plan, feature)) return null;
  return Response.json(
    { error: lockedMessage(feature), upgrade: true },
    { status: 403, headers: { "Cache-Control": "no-store" } },
  );
}

/** Learned recipient memory for API routes (empty on Free). */
export async function loadMemoryIfAllowed(
  db: SupabaseClient,
  userId: string,
): Promise<MemoryLite[]> {
  const { plan } = await getPlanInfo(db, userId);
  return can(plan, "merchantMemory") ? loadMemory(db, userId) : [];
}

export { apiError };
