import {
  formatBytes,
  type AiCosts,
  type BucketScan,
  type FeedbackItem,
  type FeatureUse,
  type LineUsage,
  type R2Operations,
  type StoredFiles,
  type UsdRate,
} from "@/lib/admin/dashboard-data";
import {
  R2_PRICES,
  lineCostThb,
  r2CostUsd,
  resolveLinePlan,
  type LineCost,
  type LinePlan,
  type PlanCost,
} from "@/lib/admin/pricing";

export type Loaded<T> = { ok: true; value: T } | { ok: false; reason: "failed" | "not_configured" };

// ---------- formatting ----------

const int = new Intl.NumberFormat("th-TH");
export const thb = (n: number) =>
  `฿${n.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const usd = (n: number) =>
  `$${n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: n > 0 && n < 1 ? 4 : 2,
  })}`;
const compact = (n: number) =>
  new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(n);

const AI_FEATURES: Record<string, string> = {
  slip: "อ่านสลิป",
  text: "แยกรายการ / เราเตอร์",
  owl: "ถามพี่ฮูก",
  pdf: "อ่าน PDF",
  audio: "ถอดเสียง",
};

const USAGE_KINDS: Record<string, string> = {
  voice: "จดด้วยเสียง",
  smart_parse: "แยกประโยคยาว",
  teaser_voice: "ลองจดด้วยเสียง",
  group_slip: "สลิปในกลุ่ม",
  pdf: "อ่าน PDF",
  owl: "ถามพี่ฮูก",
  router: "เราเตอร์ AI",
  ai_chat: "แชท AI",
  ai_out_notice: "แจ้งโควตา AI หมด",
  file_save: "เก็บไฟล์",
  group_remind: "เตือนในกลุ่ม",
  group_push: "ส่งในกลุ่ม",
};

export const COLORS = { ai: "#7c3aed", line: "#06c755", r2: "#f38020", plan: "#0ea5e9" } as const;

// ---------- small pieces ----------

function Missing({ reason, hint }: { reason: "failed" | "not_configured"; hint?: string }) {
  return (
    <p className="rounded-md border border-dashed border-border bg-background px-3 py-2 text-xs text-muted">
      {reason === "failed"
        ? "โหลดข้อมูลไม่สำเร็จ (ดู log ของ Worker)"
        : (hint ?? "ยังไม่ได้ตั้งค่า")}
    </p>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="min-w-0 rounded-md bg-background px-3 py-2.5">
      <p className="truncate text-[11px] font-medium uppercase tracking-wide text-muted">{label}</p>
      <p className="truncate text-lg font-semibold tabular-nums">{value}</p>
      {sub && <p className="truncate text-[11px] text-muted">{sub}</p>}
    </div>
  );
}

function Panel({
  title,
  tag,
  color,
  cost,
  costSub,
  delay,
  children,
}: {
  title: string;
  tag: string;
  color: string;
  cost: string;
  costSub?: string;
  delay: number;
  children: React.ReactNode;
}) {
  return (
    <section
      className="admin-rise relative flex min-w-0 flex-col overflow-hidden rounded-lg border border-border bg-surface shadow-card"
      style={{ animationDelay: `${delay}ms` }}
    >
      <div className="h-1 w-full" style={{ background: color }} />
      <div className="flex flex-1 flex-col gap-4 p-5">
        <header className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em]" style={{ color }}>
              {tag}
            </p>
            <h2 className="text-base font-semibold">{title}</h2>
          </div>
          <div className="text-right">
            <p className="text-2xl font-bold tabular-nums leading-tight">{cost}</p>
            {costSub && <p className="text-[11px] text-muted tabular-nums">{costSub}</p>}
          </div>
        </header>
        {children}
      </div>
    </section>
  );
}

function Note({ children }: { children: React.ReactNode }) {
  return <p className="mt-auto pt-1 text-[11px] leading-relaxed text-muted">{children}</p>;
}

// ---------- panels ----------

const PLAN_NAMES: Record<FeedbackItem["plan"], string> = {
  free: "Free",
  plus: "Pro",
  ultimate: "Elite",
};

/** Suggestions and comments users sent; each says where it came from (LINE chat or the app). */
export function FeedbackPanel({ items }: { items: Loaded<FeedbackItem[]> }) {
  const list = items.ok ? items.value : [];
  return (
    <Panel
      title="ข้อเสนอแนะจากผู้ใช้"
      tag="Feedback"
      color={COLORS.line}
      cost={items.ok ? `${int.format(list.length)}` : "—"}
      costSub={items.ok ? "ล่าสุด (สูงสุด 50)" : undefined}
      delay={280}
    >
      {!items.ok ? (
        <Missing reason={items.reason} />
      ) : list.length === 0 ? (
        <p className="text-sm text-muted">ยังไม่มีข้อเสนอแนะ</p>
      ) : (
        <ul className="divide-y divide-border">
          {list.map((f) => (
            <li key={f.id} className="space-y-1 py-3 first:pt-0 last:pb-0">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                <span
                  className="rounded-full px-2 py-0.5 font-semibold text-white"
                  style={{ background: f.source === "line" ? COLORS.line : COLORS.plan }}
                >
                  {f.source === "line" ? "จาก LINE" : "จากแอป"}
                </span>
                <span className="font-semibold">{f.name ?? "ไม่ทราบชื่อ"}</span>
                <span className="rounded bg-background px-1.5 py-0.5 text-muted">
                  {PLAN_NAMES[f.plan]}
                </span>
                <time className="ml-auto text-muted tabular-nums" dateTime={f.createdAt}>
                  {new Date(f.createdAt).toLocaleString("th-TH", {
                    dateStyle: "medium",
                    timeStyle: "short",
                    timeZone: "Asia/Bangkok",
                  })}
                </time>
              </div>
              <p className="whitespace-pre-wrap break-words text-sm">{f.body}</p>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

export function AiPanel({
  costs,
  uses,
  rate,
}: {
  costs: Loaded<AiCosts>;
  uses: Loaded<FeatureUse[]>;
  rate: UsdRate | null;
}) {
  const c = costs.ok ? costs.value : null;
  return (
    <Panel
      title="AI"
      tag="Gemini / LLM"
      color={COLORS.ai}
      cost={c ? usd(c.costUsd) : "—"}
      costSub={c && rate ? `≈ ${thb(c.costUsd * rate.rate)}` : undefined}
      delay={80}
    >
      {c ? (
        <>
          <div className="grid grid-cols-2 gap-2">
            <Stat label="เรียก AI" value={`${int.format(c.calls)} ครั้ง`} />
            <Stat label="Token รวม" value={compact(c.inputTokens + c.outputTokens)} />
            <Stat label="Input" value={int.format(c.inputTokens)} sub="tokens" />
            <Stat label="Output" value={int.format(c.outputTokens)} sub="tokens (รวม thinking)" />
          </div>
          {c.models.length > 0 && (
            <div className="-mx-1 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-wide text-muted">
                    <th className="px-1 py-1.5 font-medium">แยกตามโมเดล</th>
                    <th className="px-1 py-1.5 text-right font-medium">ครั้ง</th>
                    <th className="hidden px-1 py-1.5 text-right font-medium sm:table-cell">
                      In / Out
                    </th>
                    <th className="px-1 py-1.5 text-right font-medium">USD</th>
                  </tr>
                </thead>
                <tbody className="tabular-nums">
                  {c.models.map((m) => (
                    <tr key={`${m.provider}:${m.model}`} className="border-t border-border">
                      <td className="px-1 py-1.5">
                        <span className="block font-mono text-xs">{m.model}</span>
                        <span className="block text-[11px] text-muted">
                          {m.price
                            ? `$${m.price.input} in · $${m.price.output} out / 1M`
                            : "ไม่ทราบราคา"}
                        </span>
                      </td>
                      <td className="px-1 py-1.5 text-right">{int.format(m.calls)}</td>
                      <td className="hidden px-1 py-1.5 text-right sm:table-cell">
                        {compact(m.inputTokens)} / {compact(m.outputTokens)}
                      </td>
                      <td className="px-1 py-1.5 text-right">
                        {m.costUsd === null ? "—" : usd(m.costUsd)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {c.rows.length > 0 ? (
            <details className="rounded-md border border-border px-3 py-2 text-sm">
              <summary className="cursor-pointer select-none text-xs font-medium text-muted">
                แยกตามฟีเจอร์
              </summary>
              <div className="-mx-1 mt-2 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-[11px] uppercase tracking-wide text-muted">
                      <th className="px-1 py-1.5 font-medium">ฟีเจอร์ / โมเดล</th>
                      <th className="px-1 py-1.5 text-right font-medium">ครั้ง</th>
                      <th className="hidden px-1 py-1.5 text-right font-medium sm:table-cell">
                        Token
                      </th>
                      <th className="px-1 py-1.5 text-right font-medium">USD</th>
                    </tr>
                  </thead>
                  <tbody className="tabular-nums">
                    {c.rows.map((r) => (
                      <tr key={`${r.model}:${r.feature}`} className="border-t border-border">
                        <td className="px-1 py-1.5">
                          <span className="block">{AI_FEATURES[r.feature] ?? r.feature}</span>
                          <span className="block font-mono text-[11px] text-muted">{r.model}</span>
                        </td>
                        <td className="px-1 py-1.5 text-right">{int.format(r.calls)}</td>
                        <td className="hidden px-1 py-1.5 text-right sm:table-cell">
                          {compact(r.inputTokens + r.outputTokens)}
                        </td>
                        <td className="px-1 py-1.5 text-right">
                          {r.costUsd === null ? "ไม่ทราบราคา" : usd(r.costUsd)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          ) : (
            <p className="text-sm text-muted">เดือนนี้ยังไม่มีการเรียก AI ที่บันทึกไว้</p>
          )}
          {c.unpricedModels.length > 0 && (
            <p className="rounded-md bg-warn-soft px-3 py-2 text-xs text-warn">
              ไม่รู้ราคาของ {c.unpricedModels.join(", ")} จึงไม่รวมในยอด ตั้งค่า AI_PRICES
              เพื่อใส่ราคา
            </p>
          )}
        </>
      ) : (
        <Missing
          reason={costs.ok ? "failed" : costs.reason}
          hint="ยังไม่ได้รัน migration 0059_ai_usage_log.sql"
        />
      )}

      {uses.ok && uses.value.length > 0 && (
        <details className="group rounded-md border border-border px-3 py-2 text-sm">
          <summary className="cursor-pointer select-none text-xs font-medium text-muted">
            การใช้ฟีเจอร์ของผู้ใช้ (โควตา) ·{" "}
            {int.format(uses.value.reduce((n, u) => n + u.used, 0))} ครั้ง
          </summary>
          <ul className="mt-2 space-y-1 tabular-nums">
            {uses.value.map((u) => (
              <li key={u.kind} className="flex justify-between gap-2">
                <span className="truncate">{USAGE_KINDS[u.kind] ?? u.kind}</span>
                <span className="shrink-0 text-muted">
                  {int.format(u.used)} ครั้ง · {int.format(u.users)} คน
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}

      <Note>
        คิดราคาแยกตามโมเดลที่ใช้จริง (paid tier ต่อ 1 ล้าน token) ถ้าใช้ Gemini แบบ free tier
        ค่าจริงคือ $0 · โมเดลใหม่/ราคาเปลี่ยน ตั้ง AI_PRICES
        {c?.firstAt
          ? ` · เริ่มบันทึกเดือนนี้ ${new Date(c.firstAt).toLocaleString("th-TH", { timeZone: "Asia/Bangkok", dateStyle: "medium", timeStyle: "short" })}`
          : ""}
      </Note>
    </Panel>
  );
}

export function PlanPanel({ plans, rate }: { plans: PlanCost[]; rate: UsdRate | null }) {
  const total = plans.reduce((n, p) => n + p.usd, 0);
  return (
    <Panel
      title="ค่าแพลนรายเดือน"
      tag="Workers · Supabase"
      color={COLORS.plan}
      cost={usd(total)}
      costSub={rate ? `≈ ${thb(total * rate.rate)}` : undefined}
      delay={320}
    >
      <ul className="grid gap-2 sm:grid-cols-2">
        {plans.map((p) => (
          <li key={p.id} className="min-w-0 rounded-md bg-background px-3 py-2.5">
            <p className="truncate text-[11px] font-medium uppercase tracking-wide text-muted">
              {p.name}
            </p>
            <p className="text-lg font-semibold tabular-nums">{usd(p.usd)}</p>
            <p className="truncate text-[11px] text-muted">
              {p.detail}
              {rate ? ` · ≈ ${thb(p.usd * rate.rate)}` : ""}
            </p>
          </li>
        ))}
      </ul>
      <Note>
        ค่าคงที่ต่อเดือน (ไม่ใช่ตามการใช้งาน) · ตั้ง WORKERS_PLAN_USD / SUPABASE_PLAN_USD
        ถ้าเปลี่ยนแพลน (Supabase Pro = 25)
      </Note>
    </Panel>
  );
}

export function LinePanel({
  usage,
  plan,
  cost,
}: {
  usage: Loaded<LineUsage>;
  plan: LinePlan | null;
  cost: LineCost | null;
}) {
  const u = usage.ok ? usage.value : null;
  const pct = u?.quotaLimit ? Math.min(100, (u.quotaUsed / u.quotaLimit) * 100) : null;
  return (
    <Panel
      title="LINE OA"
      tag={plan ? `${plan.name} plan` : "Messaging API"}
      color={COLORS.line}
      cost={cost ? thb(cost.totalThb) : "—"}
      costSub={cost ? "รวม VAT 7%" : undefined}
      delay={160}
    >
      {u ? (
        <>
          <div className="grid grid-cols-2 gap-2">
            <Stat
              label="ส่งทั้งหมด"
              value={`${int.format(u.sent.total)} ข้อความ`}
              sub={`ถึงเมื่อวาน (${u.sent.days} วัน)`}
            />
            <Stat
              label="นับโควตา"
              value={
                u.quotaLimit === null
                  ? int.format(u.quotaUsed)
                  : `${int.format(u.quotaUsed)} / ${int.format(u.quotaLimit)}`
              }
              sub="push / broadcast"
            />
            <Stat label="Reply (ฟรี)" value={int.format(u.sent.reply)} />
            <Stat label="Push / อื่น ๆ" value={int.format(u.sent.push + u.sent.other)} />
          </div>
          {pct !== null && (
            <div>
              <div className="mb-1 flex justify-between text-[11px] text-muted tabular-nums">
                <span>โควตาเดือนนี้</span>
                <span>{pct.toFixed(0)}%</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-background">
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${Math.max(pct, 1.5)}%`,
                    background: pct >= 90 ? "var(--expense)" : COLORS.line,
                  }}
                />
              </div>
            </div>
          )}
          {cost && plan ? (
            <dl className="space-y-1 text-sm tabular-nums">
              <div className="flex justify-between">
                <dt className="text-muted">ค่าแพลนรายเดือน</dt>
                <dd>{thb(cost.feeThb)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted">
                  ข้อความเกินโควตา {int.format(cost.extraMessages)} × ฿{plan.extraThb}
                </dt>
                <dd>{thb(cost.extraThb)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted">VAT 7%</dt>
                <dd>{thb(cost.vatThb)}</dd>
              </div>
            </dl>
          ) : (
            <p className="rounded-md bg-warn-soft px-3 py-2 text-xs text-warn">
              บอกแพลนจากโควตาไม่ได้ ตั้ง LINE_OA_PLAN เป็น free, basic หรือ pro
            </p>
          )}
        </>
      ) : (
        <Missing reason={usage.ok ? "failed" : usage.reason} />
      )}
      <Note>
        ราคา LINE OA ประเทศไทย: Free ฿0 (300 ข้อความ), Basic ฿1,280 (15,000 · เกินข้อความละ ฿0.10),
        Pro ฿1,780 (35,000 · ฿0.06) ไม่รวม VAT · Reply ไม่นับโควตา
      </Note>
    </Panel>
  );
}

export function R2Panel({
  stored,
  scan,
  ops,
  rate,
}: {
  stored: Loaded<StoredFiles>;
  scan: Loaded<BucketScan>;
  ops: Loaded<R2Operations>;
  rate: UsdRate | null;
}) {
  const s = stored.ok ? stored.value : null;
  const b = scan.ok ? scan.value : null;
  const o = ops.ok ? ops.value : null;
  const bytes = b?.bytes ?? s?.bytes ?? 0;
  const cost = r2CostUsd(bytes, o?.classA ?? null, o?.classB ?? null);
  return (
    <Panel
      title="R2 Storage"
      tag="phook-files"
      color={COLORS.r2}
      cost={usd(cost.totalUsd)}
      costSub={rate ? `≈ ${thb(cost.totalUsd * rate.rate)}` : undefined}
      delay={240}
    >
      <div className="grid grid-cols-2 gap-2">
        <Stat
          label="ขนาดใน bucket"
          value={b ? formatBytes(b.bytes) : s ? formatBytes(s.bytes) : "—"}
          sub={b ? `${int.format(b.objects)} objects` : "จากฐานข้อมูล"}
        />
        <Stat
          label="ไฟล์ของผู้ใช้"
          value={s ? `${int.format(s.readyFiles)} ไฟล์` : "—"}
          sub={s && s.pendingFiles > 0 ? `+${int.format(s.pendingFiles)} รอเขียน` : "พร้อมใช้"}
        />
        <Stat
          label="Class A"
          value={o ? int.format(o.classA) : "—"}
          sub={`ฟรี ${compact(R2_PRICES.freeClassA)}/เดือน`}
        />
        <Stat
          label="Class B"
          value={o ? int.format(o.classB) : "—"}
          sub={`ฟรี ${compact(R2_PRICES.freeClassB)}/เดือน`}
        />
      </div>

      {b ? (
        <div
          className={`rounded-md px-3 py-2 text-xs ${
            b.orphanObjects > 0 || b.missingFiles > 0
              ? "bg-warn-soft text-warn"
              : "bg-primary-soft text-primary"
          }`}
        >
          {b.orphanObjects > 0
            ? `ไฟล์ค้างใน bucket ${int.format(b.orphanObjects)} ชิ้น (${formatBytes(b.orphanBytes)}) ไม่มีแถวในฐานข้อมูล`
            : "ไม่มีไฟล์ค้างใน bucket"}
          {b.missingFiles > 0 &&
            ` · ${int.format(b.missingFiles)} ไฟล์ในฐานข้อมูลหาไม่เจอใน bucket`}
          {b.truncated && " · สแกนไม่ครบ (bucket ใหญ่เกิน 100,000 ชิ้น)"}
        </div>
      ) : (
        <Missing
          reason={scan.ok ? "failed" : scan.reason}
          hint="ตรวจไฟล์ค้างไม่ได้: ไม่พบ binding FILES"
        />
      )}

      <dl className="space-y-1 text-sm tabular-nums">
        <div className="flex justify-between">
          <dt className="text-muted">พื้นที่ (เกิน 10 GB × $0.015)</dt>
          <dd>{usd(cost.storageUsd)}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-muted">Class A (เกิน 1M × $4.50/M)</dt>
          <dd>{usd(cost.classAUsd)}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-muted">Class B (เกิน 10M × $0.36/M)</dt>
          <dd>{usd(cost.classBUsd)}</dd>
        </div>
      </dl>

      {!o && (
        <Missing
          reason={ops.ok ? "failed" : ops.reason}
          hint="ยังไม่มีจำนวน Class A/B: ตั้ง CF_ACCOUNT_ID และ CF_ANALYTICS_TOKEN"
        />
      )}
      <Note>
        Class A/B นับทั้งบัญชี (โควตาฟรีคิดต่อบัญชี) ตั้งแต่วันที่ 1 ของเดือน ไม่ใช่รอบบิลจริง ·
        Egress ฟรี
      </Note>
    </Panel>
  );
}

// ---------- the whole page ----------

export interface AdminViewProps {
  month: string;
  today: string;
  aiCosts: Loaded<AiCosts>;
  uses: Loaded<FeatureUse[]>;
  line: Loaded<LineUsage>;
  stored: Loaded<StoredFiles>;
  scan: Loaded<BucketScan>;
  ops: Loaded<R2Operations>;
  feedback: Loaded<FeedbackItem[]>;
  rate: UsdRate | null;
  plans: PlanCost[];
}

export function AdminView({
  month,
  today,
  aiCosts,
  uses,
  line,
  stored,
  scan,
  ops,
  feedback,
  rate,
  plans,
}: AdminViewProps) {
  const plan = line.ok ? resolveLinePlan(line.value.quotaLimit) : null;
  const lineCost = line.ok && plan ? lineCostThb(plan, line.value.quotaUsed) : null;
  const r2 = r2CostUsd(
    scan.ok ? scan.value.bytes : stored.ok ? stored.value.bytes : 0,
    ops.ok ? ops.value.classA : null,
    ops.ok ? ops.value.classB : null,
  );

  const parts = [
    {
      key: "ai",
      label: "AI",
      color: COLORS.ai,
      thb: aiCosts.ok && rate ? aiCosts.value.costUsd * rate.rate : null,
    },
    { key: "line", label: "LINE OA", color: COLORS.line, thb: lineCost?.totalThb ?? null },
    { key: "r2", label: "R2", color: COLORS.r2, thb: rate ? r2.totalUsd * rate.rate : null },
    {
      key: "plan",
      label: "ค่าแพลน",
      color: COLORS.plan,
      thb: rate ? plans.reduce((n, p) => n + p.usd, 0) * rate.rate : null,
    },
  ];
  const total = parts.reduce((n, p) => n + (p.thb ?? 0), 0);
  const partial = parts.some((p) => p.thb === null) || !ops.ok;
  const monthLabel = new Date(`${month}T00:00:00+07:00`).toLocaleDateString("th-TH", {
    month: "long",
    year: "numeric",
    timeZone: "Asia/Bangkok",
  });

  return (
    <div className="min-h-screen bg-background text-foreground">
      <style>{`
        @keyframes admin-rise { from { opacity: 0; transform: translateY(8px) } to { opacity: 1; transform: none } }
        .admin-rise { animation: admin-rise .5s cubic-bezier(.2,.7,.2,1) both }
        @media (prefers-reduced-motion: reduce) { .admin-rise { animation: none } }
      `}</style>
      <main className="mx-auto w-full max-w-7xl space-y-5 px-4 py-6 sm:px-6 lg:px-8 lg:py-10">
        <header className="admin-rise flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-primary">
              P-Hook · Admin
            </p>
            <h1 className="text-2xl font-bold sm:text-3xl">ค่าใช้จ่ายระบบ</h1>
            <p className="text-sm text-muted">
              เดือน{monthLabel} · ข้อมูล ณ {today}
            </p>
          </div>
          <p className="rounded-full border border-border bg-surface px-3 py-1 text-xs text-muted tabular-nums">
            {rate
              ? `1 USD = ${rate.rate.toFixed(2)} บาท · ${rate.source}`
              : "ไม่มีอัตราแลกเปลี่ยน USD"}
          </p>
        </header>

        <section
          className="admin-rise relative overflow-hidden rounded-lg p-6 text-[var(--hero-ink)] shadow-card sm:p-8"
          style={{ background: "linear-gradient(135deg, var(--hero-from), var(--hero-to))" }}
        >
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 opacity-[0.08]"
            style={{
              backgroundImage:
                "linear-gradient(#fff 1px, transparent 1px), linear-gradient(90deg, #fff 1px, transparent 1px)",
              backgroundSize: "28px 28px",
            }}
          />
          <div
            aria-hidden
            className="pointer-events-none absolute -right-16 -top-20 h-64 w-64 rounded-full opacity-30 blur-3xl"
            style={{ background: "var(--hero-glow)" }}
          />
          <div className="relative grid gap-6 lg:grid-cols-[1.2fr_1fr] lg:items-end">
            <div>
              <p className="text-sm text-[var(--hero-ink-soft)]">
                ยอดรวมเดือนนี้ (AI + LINE + R2 + ค่าแพลน)
              </p>
              <p className="mt-1 text-4xl font-bold tabular-nums tracking-tight sm:text-5xl lg:text-6xl">
                {thb(total)}
              </p>
              <p className="mt-2 text-xs text-[var(--hero-ink-soft)]">
                {partial
                  ? "ยอดประมาณ: บางส่วนยังไม่มีข้อมูล (ดูการ์ดด้านล่าง)"
                  : "ยอดประมาณจากการใช้งานจริงและราคาปัจจุบัน"}
              </p>
            </div>
            <div className="space-y-3">
              <div className="flex h-3 overflow-hidden rounded-full bg-white/15">
                {total > 0 &&
                  parts.map((p) =>
                    p.thb ? (
                      <div
                        key={p.key}
                        style={{ width: `${(p.thb / total) * 100}%`, background: p.color }}
                      />
                    ) : null,
                  )}
              </div>
              <ul className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
                {parts.map((p) => (
                  <li key={p.key} className="min-w-0 rounded-md bg-white/10 px-3 py-2">
                    <span className="flex items-center gap-1.5 text-[11px] text-[var(--hero-ink-soft)]">
                      <span
                        className="h-2 w-2 shrink-0 rounded-full"
                        style={{ background: p.color }}
                      />
                      {p.label}
                    </span>
                    <span className="block truncate font-semibold tabular-nums">
                      {p.thb === null ? "—" : thb(p.thb)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          <AiPanel costs={aiCosts} uses={uses} rate={rate} />
          <LinePanel usage={line} plan={plan} cost={lineCost} />
          <R2Panel stored={stored} scan={scan} ops={ops} rate={rate} />
          <div className="md:col-span-2 xl:col-span-3">
            <PlanPanel plans={plans} rate={rate} />
          </div>
          <div className="md:col-span-2 xl:col-span-3">
            <FeedbackPanel items={feedback} />
          </div>
        </div>

        <footer className="text-center text-[11px] text-muted">
          ราคาตรวจเมื่อ 7 พ.ย. 2026 อาจเปลี่ยนได้ · ยังไม่รวมค่า Cloudflare อื่น ๆ (เช่น
          Images/Stream)
        </footer>
      </main>
    </div>
  );
}
