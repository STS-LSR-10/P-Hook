import type { SupabaseClient } from "@supabase/supabase-js";
import {
  billReminderText,
  cardBills,
  dueReminders,
  todayKey,
  type BillDto,
  type DueReminder,
} from "@/lib/bill";
import {
  claimReminder,
  listBillsForUsers,
  pruneReminders,
  sentKeysForUsers,
} from "@/lib/bill-repo";
import { log } from "@/lib/log";
import { can, effectivePlan, type Plan } from "@/lib/plan";
import type { LineMessage } from "@/lib/types";
import { listWallets } from "@/lib/wallet-repo";
import { runInZone } from "@/lib/zone-scope";

export interface BillRunSummary {
  users: number;
  sent: number;
  errors: number;
}

const BATCH = 1000;
/** Sent-reminder keys are looked at for this long (they only matter around the due date). */
const KEEP_DAYS = 45;

/** The reminder as a chat message: the text and, for real bills, the buttons to answer it. */
export function billReminderMessage(r: DueReminder): LineMessage {
  const text = billReminderText(r);
  if (r.bill.fromCard) return { type: "text", text };
  const action = (label: string, data: string) => ({
    type: "action",
    action: { type: "postback", label, data, displayText: label },
  });
  return {
    type: "text",
    text,
    quickReply: {
      items: [
        action("✅ จ่ายแล้ว", `a=bp&id=${r.bill.id}&d=${r.bill.nextDueOn}`),
        action("⏰ เตือนอีกวันพรุ่งนี้", `a=bz&id=${r.bill.id}`),
        action("ข้ามรอบนี้", `a=bk&id=${r.bill.id}&d=${r.bill.nextDueOn}`),
      ],
    },
  };
}

/**
 * Hourly: push the bill reminders that are due now to Elite users (their own bills, and the due
 * day of their credit cards). Each reminder is marked as sent before it goes out, so a failing push
 * (blocked account) is not retried every hour.
 */
export async function runBillReminders(
  db: SupabaseClient,
  push: (lineUserId: string, messages: LineMessage[]) => Promise<void>,
  now: Date,
): Promise<BillRunSummary> {
  const summary: BillRunSummary = { users: 0, sent: 0, errors: 0 };

  const users = await db
    .from("users")
    .select("id,line_user_id,plan,plan_expires_at,timezone,currency,locale")
    .in("plan", ["ultimate"])
    .limit(BATCH);
  if (users.error) throw new Error(`load bill users: ${users.error.message}`);
  const ultimate = (
    (users.data ?? []) as {
      id: string;
      line_user_id: string;
      plan: Plan;
      plan_expires_at: string | null;
      timezone?: string | null;
      currency?: string | null;
      locale?: string | null;
    }[]
  ).filter((u) => can(effectivePlan(u.plan, u.plan_expires_at, now), "billReminder"));
  summary.users = ultimate.length;
  if (ultimate.length === 0) return summary;

  const ids = ultimate.map((u) => u.id);
  const since = new Date(now.getTime() - KEEP_DAYS * 86_400_000);
  const [billsByUser, sentByUser] = await Promise.all([
    listBillsForUsers(db, ids),
    sentKeysForUsers(db, ids, since),
  ]);

  // each person's bills fall due, and are reminded at their hour, in their own zone
  for (const user of ultimate)
    await runInZone(user.timezone, () => remindOne(user), user.currency, user.locale);
  await pruneReminders(db, new Date(now.getTime() - 120 * 86_400_000)).catch((error: unknown) =>
    log.error("bill_prune_failed", error),
  );
  return summary;

  async function remindOne(user: (typeof ultimate)[number]): Promise<void> {
    const today = todayKey(now);
    try {
      const own: BillDto[] = billsByUser.get(user.id) ?? [];
      const wallets = await listWallets(db, user.id).catch(() => []);
      const all = [...own, ...cardBills(wallets, today)];
      const due = dueReminders(all, now, sentByUser.get(user.id) ?? new Set());
      for (const reminder of due) {
        if (!(await claimReminder(db, user.id, reminder.key))) continue;
        try {
          await push(user.line_user_id, [billReminderMessage(reminder)]);
          summary.sent += 1;
        } catch (error) {
          summary.errors += 1;
          log.error("bill_reminder_push_failed", error);
        }
      }
    } catch (error) {
      summary.errors += 1;
      log.error("bill_reminder_failed", error);
    }
  }
}
