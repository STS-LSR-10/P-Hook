import { ACTIVITY_GROUPS, findActivity, type ActivityRow } from "@/lib/admin/activity";
import { AdminTabs } from "./tabs";

const n = (v: number) => v.toLocaleString("th-TH");
const MONTHS = [
  "ม.ค.",
  "ก.พ.",
  "มี.ค.",
  "เม.ย.",
  "พ.ค.",
  "มิ.ย.",
  "ก.ค.",
  "ส.ค.",
  "ก.ย.",
  "ต.ค.",
  "พ.ย.",
  "ธ.ค.",
];
const monthLabel = (month: string) => {
  const [y = 0, m = 1] = month.split("-").map(Number);
  return `${MONTHS[m - 1]} ${y + 543}`;
};

function Cell({ row, strong }: { row: ActivityRow; strong?: boolean }) {
  return (
    <td className="px-3 py-2 text-right tabular-nums">
      <span className={strong ? "font-semibold" : ""}>{n(row.uses)}</span>
      <span className="text-muted"> ครั้ง · {n(row.people)} คน</span>
    </td>
  );
}

export function UsageView({
  period,
  columns,
  feedbackTotal,
}: {
  period: { month: string; year: string };
  columns: [ActivityRow[], ActivityRow[], ActivityRow[]] | null;
  feedbackTotal: number | null;
}) {
  const thisYear = Number(period.year);
  const newest = Math.max(thisYear, new Date().getFullYear());
  const years = Array.from({ length: 6 }, (_, i) => String(newest - i));
  if (!years.includes(period.year)) years.push(period.year); // a year typed in the address
  return (
    <div className="min-h-screen bg-background text-foreground">
      <main className="mx-auto w-full max-w-7xl space-y-5 px-4 py-6 sm:px-6 lg:px-8 lg:py-10">
        <header>
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-primary">
            P-Hook · Admin
          </p>
          <h1 className="text-2xl font-bold sm:text-3xl">จำนวนการใช้งาน</h1>
        </header>

        <AdminTabs active="usage" feedbackTotal={feedbackTotal} />

        <form method="get" className="flex flex-wrap items-end gap-3 text-sm">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-semibold text-muted">เดือน</span>
            <input
              type="month"
              name="month"
              defaultValue={period.month}
              className="h-10 rounded-lg border border-border bg-surface px-3"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-semibold text-muted">ปี (ค.ศ.)</span>
            <select
              name="year"
              defaultValue={period.year}
              className="h-10 rounded-lg border border-border bg-surface px-3"
            >
              {years.map((y) => (
                <option key={y} value={y}>
                  {Number(y) + 543} ({y})
                </option>
              ))}
            </select>
          </label>
          <button
            type="submit"
            className="h-10 rounded-full bg-primary px-5 font-semibold text-surface"
          >
            ดู
          </button>
        </form>

        {columns === null ? (
          <p
            role="alert"
            className="rounded-lg border border-border bg-surface p-5 text-sm text-muted"
          >
            โหลดจำนวนการใช้งานไม่สำเร็จ (รัน migration 0071 หรือยัง) ลองรีเฟรชอีกครั้ง
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border bg-surface">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="text-[11px] uppercase tracking-wide text-muted">
                <tr className="border-b border-border">
                  <th scope="col" className="px-3 py-2">
                    การใช้งาน
                  </th>
                  <th scope="col" className="px-3 py-2 text-right">
                    {monthLabel(period.month)}
                  </th>
                  <th scope="col" className="px-3 py-2 text-right">
                    ปี {thisYear + 543}
                  </th>
                  <th scope="col" className="px-3 py-2 text-right">
                    ทั้งหมด
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {ACTIVITY_GROUPS.flatMap((g) => [
                  <tr key={g.grp} className="bg-background/40">
                    <th scope="row" className="px-3 py-2 font-semibold">
                      {g.label}
                    </th>
                    {columns.map((rows, i) => (
                      <Cell key={i} row={findActivity(rows, g.grp, null)} strong />
                    ))}
                  </tr>,
                  ...g.kinds
                    // a kind nobody has ever used (the old reminders, say) is left out
                    .filter(([kind]) => findActivity(columns[2], g.grp, kind).uses > 0)
                    .map(([kind, label]) => (
                      <tr key={kind}>
                        <th scope="row" className="px-3 py-2 pl-8 font-normal text-muted">
                          {label}
                        </th>
                        {columns.map((rows, i) => (
                          <Cell key={i} row={findActivity(rows, g.grp, kind)} />
                        ))}
                      </tr>
                    )),
                ])}
              </tbody>
            </table>
          </div>
        )}

        <p className="text-[11px] text-muted">
          เวลาไทย · “คน” คือจำนวนบัญชีที่ใช้อย่างน้อยหนึ่งครั้งในช่วงนั้น · ตั้งเตือน โน้ต รูป
          และไฟล์ก่อนเริ่มนับ ดึงจากข้อมูลที่ยังอยู่ (ที่ถูกลบไปก่อนหน้านี้ไม่มีในตัวเลข)
          และเตือนช่วงนั้นไม่ได้แยกช่องทาง · การกดเพิ่มลงปฏิทินเริ่มนับตั้งแต่ deploy ·
          จดรายการนับเฉพาะที่ยังอยู่ (ไม่นับที่ถูกลบหรือยกเลิก) · งานในกลุ่ม (เตือนกลุ่ม ไฟล์กลุ่ม
          และปฏิทินจากการ์ดกลุ่ม) นับ “คน” เป็นเจ้าของสมุดกลุ่ม ไม่ใช่สมาชิกที่กด
        </p>
      </main>
    </div>
  );
}
