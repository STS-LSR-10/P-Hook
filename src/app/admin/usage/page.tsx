import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { isAdminRequest } from "@/lib/admin/access";
import { loadActivityColumns, readPeriod } from "@/lib/admin/activity";
import { feedbackCounts } from "@/lib/admin/dashboard-data";
import { log } from "@/lib/log";
import { getAdminClient } from "@/lib/supabase/admin";
import { UsageView } from "../usage-view";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "P-Hook Admin · จำนวนการใช้งาน",
  robots: { index: false, follow: false },
};

export default async function AdminUsagePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (!(await isAdminRequest(await headers()))) notFound();
  const db = getAdminClient();
  const period = readPeriod(await searchParams, new Date());
  const feedback = await feedbackCounts(db, "all")
    .then((c) => c.all)
    .catch(() => null);
  try {
    const columns = await loadActivityColumns(db, period);
    return <UsageView period={period} columns={columns} feedbackTotal={feedback} />;
  } catch (error) {
    log.error("admin_usage", error);
    return <UsageView period={period} columns={null} feedbackTotal={feedback} />;
  }
}
