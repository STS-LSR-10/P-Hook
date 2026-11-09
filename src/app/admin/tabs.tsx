import Link from "next/link";

/** The admin's pages: what the system costs, who the members are, and what users wrote to us. */
export function AdminTabs({
  active,
  feedbackTotal,
}: {
  active: "cost" | "members" | "feedback";
  feedbackTotal: number | null;
}) {
  const tab = (on: boolean) =>
    `inline-flex h-10 items-center gap-2 rounded-full px-4 text-sm font-semibold transition-colors ${
      on
        ? "bg-primary text-surface"
        : "border border-border bg-surface text-muted hover:text-foreground"
    }`;
  return (
    <nav aria-label="หน้าของ admin" className="admin-rise flex flex-wrap gap-2">
      <Link
        href="/admin"
        aria-current={active === "cost" ? "page" : undefined}
        className={tab(active === "cost")}
      >
        ค่าใช้จ่ายระบบ
      </Link>
      <Link
        href="/admin/members"
        aria-current={active === "members" ? "page" : undefined}
        className={tab(active === "members")}
      >
        สมาชิก
      </Link>
      <Link
        href="/admin/feedback"
        aria-current={active === "feedback" ? "page" : undefined}
        className={tab(active === "feedback")}
      >
        ข้อเสนอแนะ
        {feedbackTotal !== null ? (
          <span
            className={`rounded-full px-2 py-0.5 text-[11px] tabular-nums ${
              active === "feedback" ? "bg-white/25" : "bg-background"
            }`}
          >
            {feedbackTotal.toLocaleString("th-TH")}
          </span>
        ) : null}
      </Link>
    </nav>
  );
}
