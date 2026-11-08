import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { isAdminRequest } from "@/lib/admin/access";
import { feedbackCounts, loadFeedbackPage, parseFeedbackQuery } from "@/lib/admin/dashboard-data";
import { log } from "@/lib/log";
import { getAdminClient } from "@/lib/supabase/admin";
import { FeedbackView } from "../feedback-view";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "P-Hook Admin · ข้อเสนอแนะ",
  robots: { index: false, follow: false },
};

export default async function AdminFeedbackPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (!(await isAdminRequest(await headers()))) notFound();

  const query = parseFeedbackQuery(await searchParams);
  const db = getAdminClient();
  try {
    const [page, counts] = await Promise.all([
      loadFeedbackPage(db, query),
      feedbackCounts(db, query.plan),
    ]);
    // the tab's badge counts everything, whatever the plan filter
    const all = query.plan === "all" ? counts : await feedbackCounts(db, "all");
    return (
      <FeedbackView
        query={{ ...query, page: page.page }}
        page={page}
        counts={counts}
        total={all.all}
      />
    );
  } catch (error) {
    log.error("admin_feedback", error);
    return <FeedbackView query={query} page={null} counts={null} total={null} />;
  }
}
