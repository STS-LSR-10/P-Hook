import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { isAdminRequest } from "@/lib/admin/access";
import {
  R2_FREE_GB,
  formatBytes,
  loadAiUsage,
  loadLineQuota,
  loadStorage,
  type AiKindUsage,
  type LineQuota,
  type StorageUsage,
} from "@/lib/admin/dashboard-data";
import { getServerEnv } from "@/lib/env";
import { log } from "@/lib/log";
import { getAdminClient } from "@/lib/supabase/admin";
import { monthKey } from "@/lib/usage";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "P-Hook Admin",
  robots: { index: false, follow: false },
};

type Loaded<T> = { ok: true; value: T } | { ok: false };

async function load<T>(event: string, fn: () => Promise<T>): Promise<Loaded<T>> {
  try {
    return { ok: true, value: await fn() };
  } catch (error) {
    log.error(event, error);
    return { ok: false };
  }
}

const number = new Intl.NumberFormat("th-TH");

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
      <h2 className="mb-3 text-base font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function Failed() {
  return <p className="text-sm text-red-600">โหลดข้อมูลไม่สำเร็จ (ดู log ของ Worker)</p>;
}

function AiCard({ data }: { data: Loaded<AiKindUsage[]> }) {
  if (!data.ok) return <Failed />;
  const total = data.value.reduce((n, r) => n + r.used, 0);
  return (
    <>
      <p className="mb-3 text-3xl font-bold">
        {number.format(total)} <span className="text-sm font-normal text-neutral-500">ครั้ง</span>
      </p>
      {data.value.length === 0 ? (
        <p className="text-sm text-neutral-500">เดือนนี้ยังไม่มีการใช้งาน</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-neutral-500">
              <th className="py-1 font-medium">ฟีเจอร์</th>
              <th className="py-1 text-right font-medium">ครั้ง</th>
              <th className="py-1 text-right font-medium">ผู้ใช้</th>
            </tr>
          </thead>
          <tbody>
            {data.value.map((r) => (
              <tr key={r.kind} className="border-t border-neutral-100">
                <td className="py-1 font-mono">{r.kind}</td>
                <td className="py-1 text-right">{number.format(r.used)}</td>
                <td className="py-1 text-right">{number.format(r.users)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="mt-3 text-xs text-neutral-500">
        นับจำนวนครั้งที่ใช้ฟีเจอร์ AI (usage_counters) ไม่ใช่ค่าใช้จ่ายจริง
        เพราะระบบยังไม่ได้บันทึกจำนวนโทเคนของแต่ละครั้งที่เรียก AI ดูค่าใช้จ่ายจริงที่หน้า billing
        ของผู้ให้บริการ AI
      </p>
    </>
  );
}

function LineCard({ data }: { data: Loaded<LineQuota> }) {
  if (!data.ok) return <Failed />;
  const { type, limit, used } = data.value;
  const pct = limit ? Math.min(100, Math.round((used / limit) * 100)) : null;
  return (
    <>
      <p className="mb-1 text-3xl font-bold">
        {number.format(used)}
        {limit !== null && (
          <span className="text-sm font-normal text-neutral-500">
            {" "}
            / {number.format(limit)} ข้อความ
          </span>
        )}
      </p>
      {pct !== null && (
        <div className="mb-2 h-2 overflow-hidden rounded bg-neutral-100">
          <div
            className={`h-full ${pct >= 90 ? "bg-red-500" : "bg-green-500"}`}
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
      <p className="text-sm text-neutral-600">
        {type === "limited"
          ? `ใช้ไป ${pct}% ของโควตาเดือนนี้`
          : type === "none"
            ? "แผนนี้ไม่จำกัดโควตา"
            : "อ่านชนิดโควตาไม่ได้"}
      </p>
      <p className="mt-3 text-xs text-neutral-500">
        จาก LINE Messaging API: นับข้อความ Push/Multicast/Broadcast ส่วนการตอบกลับ (Reply)
        ไม่นับโควตา
      </p>
    </>
  );
}

function R2Card({ data }: { data: Loaded<StorageUsage> }) {
  if (!data.ok) return <Failed />;
  const s = data.value;
  return (
    <>
      <p className="mb-1 text-3xl font-bold">{formatBytes(s.bytes)}</p>
      <p className="text-sm text-neutral-600">
        {number.format(s.readyFiles)} ไฟล์พร้อมใช้
        {s.pendingFiles > 0 && ` · ${number.format(s.pendingFiles)} ไฟล์รอเขียน`}
      </p>
      <p className="mt-2 text-sm">
        ค่าเก็บข้อมูลโดยประมาณ <strong>${s.estimatedUsd.toFixed(2)}</strong>/เดือน
      </p>
      <p className="mt-3 text-xs text-neutral-500">
        คำนวณจากขนาดไฟล์ในฐานข้อมูล (ฟรี {R2_FREE_GB} GB แรก แล้ว $0.015/GB-เดือน)
        ไม่รวมจำนวนครั้งที่อ่าน/เขียน (Class A/B) และไฟล์ที่อาจค้างใน bucket โดยไม่มีแถวในฐานข้อมูล
      </p>
    </>
  );
}

export default async function AdminPage() {
  if (!(await isAdminRequest(await headers()))) notFound();

  const month = monthKey(new Date());
  const db = getAdminClient();
  const [ai, line, r2] = await Promise.all([
    load("admin_ai_usage", () => loadAiUsage(db, month)),
    load("admin_line_quota", () => loadLineQuota(getServerEnv().LINE_CHANNEL_ACCESS_TOKEN)),
    load("admin_storage", () => loadStorage(db)),
  ]);

  return (
    <main className="mx-auto max-w-3xl space-y-4 p-4 sm:p-6">
      <header>
        <h1 className="text-xl font-bold">P-Hook Admin</h1>
        <p className="text-sm text-neutral-500">การใช้งานเดือน {month.slice(0, 7)} (เวลาไทย)</p>
      </header>
      <Card title="AI">
        <AiCard data={ai} />
      </Card>
      <Card title="LINE">
        <LineCard data={line} />
      </Card>
      <Card title="R2 (ไฟล์ของผู้ใช้)">
        <R2Card data={r2} />
      </Card>
    </main>
  );
}
