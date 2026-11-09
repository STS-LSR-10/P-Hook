import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { isAdminRequest } from "@/lib/admin/access";
import { feedbackCounts } from "@/lib/admin/dashboard-data";
import { loadMembers } from "@/lib/admin/members";
import { log } from "@/lib/log";
import { getAdminClient } from "@/lib/supabase/admin";
import { MembersView } from "../members-view";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "P-Hook Admin · สมาชิก",
  robots: { index: false, follow: false },
};

export default async function AdminMembersPage() {
  if (!(await isAdminRequest(await headers()))) notFound();
  const db = getAdminClient();
  const feedback = await feedbackCounts(db, "all")
    .then((c) => c.all)
    .catch(() => null);
  try {
    return <MembersView data={await loadMembers(db, new Date())} feedbackTotal={feedback} />;
  } catch (error) {
    log.error("admin_members", error);
    return <MembersView data={null} feedbackTotal={feedback} />;
  }
}
