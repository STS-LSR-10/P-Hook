import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { isAdminRequest } from "@/lib/admin/access";
import {
  getListableBucket,
  loadAiCosts,
  loadFeatureUses,
  loadFeedback,
  loadLineUsage,
  loadR2Operations,
  loadStoredFiles,
  loadUsdThb,
  monthRange,
  scanBucket,
} from "@/lib/admin/dashboard-data";
import { readAiPrices, readPlanCosts } from "@/lib/admin/pricing";
import { getServerEnv } from "@/lib/env";
import { log } from "@/lib/log";
import { getAdminClient } from "@/lib/supabase/admin";
import { dayKey, monthKey } from "@/lib/usage";
import { AdminView, type Loaded } from "./panels";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "P-Hook Admin",
  robots: { index: false, follow: false },
};

// ---------- loading ----------

async function load<T>(event: string, fn: () => Promise<T | null>): Promise<Loaded<T>> {
  try {
    const value = await fn();
    return value === null ? { ok: false, reason: "not_configured" } : { ok: true, value };
  } catch (error) {
    log.error(event, error);
    return { ok: false, reason: "failed" };
  }
}

// ---------- page ----------

export default async function AdminPage() {
  if (!(await isAdminRequest(await headers()))) notFound();

  const now = new Date();
  const month = monthKey(now);
  const today = dayKey(now);
  const range = monthRange(month);
  const db = getAdminClient();
  const prices = readAiPrices();
  const env = process.env;

  const [aiCosts, uses, line, stored, ops, feedback, rate] = await Promise.all([
    load("admin_ai_costs", () => loadAiCosts(db, month, prices)),
    load("admin_feature_uses", () => loadFeatureUses(db, month)),
    load("admin_line_usage", () => loadLineUsage(getServerEnv().LINE_CHANNEL_ACCESS_TOKEN, today)),
    load("admin_stored_files", () => loadStoredFiles(db)),
    load("admin_r2_ops", async () =>
      env.CF_ACCOUNT_ID && env.CF_ANALYTICS_TOKEN
        ? loadR2Operations(env.CF_ACCOUNT_ID, env.CF_ANALYTICS_TOKEN, range.from, range.to)
        : null,
    ),
    load("admin_feedback", () => loadFeedback(db)),
    loadUsdThb(db, today).catch(() => null),
  ]);
  const scan = await load("admin_bucket_scan", async () => {
    const bucket = await getListableBucket();
    if (!bucket) return null;
    return scanBucket(bucket, stored.ok ? stored.value.keys : new Map());
  });

  return (
    <AdminView
      month={month}
      today={today}
      aiCosts={aiCosts}
      uses={uses}
      line={line}
      stored={stored}
      scan={scan}
      ops={ops}
      feedback={feedback}
      rate={rate}
      plans={readPlanCosts()}
    />
  );
}
