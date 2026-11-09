import type { MembersData } from "@/lib/admin/members";
import { PLAN_LABEL, PLAN_ORDER } from "@/lib/plan";
import { EARLY_BIRD } from "@/lib/pricing";
import { COLORS, Panel } from "./panels";
import { AdminTabs } from "./tabs";

const PERIOD_LABEL = { yearly: "รายปี", monthly: "รายเดือน (เดือนแรก)" } as const;
const n = (v: number) => v.toLocaleString("th-TH");

export function MembersView({
  data,
  feedbackTotal,
}: {
  data: MembersData | null;
  feedbackTotal: number | null;
}) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <style>{`
        @keyframes admin-rise { from { opacity: 0; transform: translateY(8px) } to { opacity: 1; transform: none } }
        .admin-rise { animation: admin-rise .5s cubic-bezier(.2,.7,.2,1) both }
        @media (prefers-reduced-motion: reduce) { .admin-rise { animation: none } }
      `}</style>
      <main className="mx-auto w-full max-w-7xl space-y-5 px-4 py-6 sm:px-6 lg:px-8 lg:py-10">
        <header className="admin-rise">
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-primary">
            P-Hook · Admin
          </p>
          <h1 className="text-2xl font-bold sm:text-3xl">สมาชิกและสิทธิ์ Early Bird</h1>
        </header>

        <AdminTabs active="members" feedbackTotal={feedbackTotal} />

        {data === null ? (
          <p
            role="alert"
            className="rounded-lg border border-border bg-surface p-5 text-sm text-muted"
          >
            โหลดข้อมูลสมาชิกไม่สำเร็จ ลองรีเฟรชอีกครั้ง
          </p>
        ) : (
          <div className="grid gap-5 lg:grid-cols-2">
            <Panel
              title="ผู้ใช้แยกตามแผน"
              tag="Members"
              color={COLORS.plan}
              cost={n(data.total)}
              costSub="บัญชีทั้งหมด"
              delay={80}
            >
              <ul className="divide-y divide-border text-sm">
                {PLAN_ORDER.map((p) => (
                  <li key={p} className="flex items-center justify-between py-2">
                    <span>{PLAN_LABEL[p]}</span>
                    <span className="font-semibold tabular-nums">{n(data.byPlan[p])}</span>
                  </li>
                ))}
              </ul>
              <p className="text-[11px] text-muted">
                นับตามแผนที่ใช้อยู่ตอนนี้ (แผนที่หมดอายุนับเป็น Free) · เคยทดลองใช้ฟรี{" "}
                {n(data.trials)} คน
              </p>
            </Panel>

            <Panel
              title="สิทธิ์ Early Bird คงเหลือ"
              tag="Early Bird"
              color={COLORS.line}
              cost={n(data.offers.reduce((s, o) => s + (o.remaining ?? 0), 0))}
              costSub="รวมเฉพาะรายการที่จำกัดสิทธิ์"
              delay={140}
            >
              {data.offers.length === 0 ? (
                <p className="text-sm text-muted">ยังไม่พบข้อมูล (รัน migration 0065 หรือยัง)</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="text-[11px] uppercase tracking-wide text-muted">
                      <tr>
                        <th className="py-1 pr-3 font-semibold">แผน</th>
                        <th className="py-1 pr-3 font-semibold">รอบ</th>
                        <th className="py-1 pr-3 font-semibold">ราคา</th>
                        <th className="py-1 pr-3 text-right font-semibold">จ่ายแล้ว</th>
                        <th className="py-1 pr-3 text-right font-semibold">จองอยู่</th>
                        <th className="py-1 text-right font-semibold">คงเหลือ</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {[...data.offers]
                        .sort(
                          (a, b) =>
                            PLAN_ORDER.indexOf(a.plan) - PLAN_ORDER.indexOf(b.plan) ||
                            a.period.localeCompare(b.period),
                        )
                        .map((o) => (
                          <tr key={`${o.plan}-${o.period}`}>
                            <td className="py-2 pr-3 font-semibold">{PLAN_LABEL[o.plan]}</td>
                            <td className="py-2 pr-3">{PERIOD_LABEL[o.period]}</td>
                            <td className="py-2 pr-3 tabular-nums">
                              ฿{n(EARLY_BIRD[o.plan][o.period])}
                            </td>
                            <td className="py-2 pr-3 text-right tabular-nums">{n(o.paid)}</td>
                            <td className="py-2 pr-3 text-right tabular-nums">
                              {n(o.taken - o.paid)}
                            </td>
                            <td className="py-2 text-right font-semibold tabular-nums">
                              {o.remaining === null
                                ? "ไม่จำกัด"
                                : `${n(o.remaining)} / ${n(o.total ?? 0)}`}
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              )}
              <p className="text-[11px] text-muted">
                จองอยู่ = เปิดหน้าชำระเงินแล้วแต่ยังไม่จ่าย (คืนสิทธิ์เองใน 30 นาที)
              </p>
            </Panel>
          </div>
        )}
      </main>
    </div>
  );
}
