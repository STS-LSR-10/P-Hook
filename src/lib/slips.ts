import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { categorizeByRules } from "@/lib/categorize/rules";
import { buildReceiptCard, type ReceiptCardEntry } from "@/lib/line/receipt-flex";
import { extensionFor, ImageError } from "@/lib/line/content";
import {
  ALREADY_RECORDED_TEXT,
  IMAGE_ERROR_TEXT,
  IMAGE_TOO_LARGE_TEXT,
  NOT_A_SLIP_TEXT,
  SLIP_LOCKED_TEXT,
  SLIP_FAIR_USE_TEXT,
  SLIP_QUOTA_TEXT,
  SLIP_FREE_LEFT_TEXT,
  SLIP_UNREADABLE_TEXT,
  text,
} from "@/lib/line/messages";
import { formatBaht, toSatang } from "@/lib/money";
import type { SlipImage, SlipOcrProvider } from "@/lib/ocr/provider";
import { sanitizeSlip } from "@/lib/ocr/slip-schema";
import {
  effectivePlan,
  FAIR_USE,
  FREE_SLIPS_PER_WEEK,
  SLIP_LIMIT,
  slipsRemaining,
} from "@/lib/plan";
import { planReceiptSplit } from "@/lib/receipt-split";
import {
  insertTransaction,
  loadCategories,
  loadMemoryFor,
  updateTransaction,
  type TxRow,
  type UserRow,
} from "@/lib/repo";
import {
  countSlipsThisMonth,
  countSlipsThisWeek,
  findSlipByHash,
  findSlipByRef,
  findTransactionBySlip,
  getUserPlanRow,
  insertSlip,
  SLIP_BUCKET,
} from "@/lib/slip-repo";
import { upsellReply } from "@/lib/line/upsell-reply";
import { log } from "@/lib/log";
import type { LineMessage } from "@/lib/types";

export interface SlipDeps {
  db: SupabaseClient;
  now: () => Date;
  fetchImage: (messageId: string) => Promise<SlipImage>;
  ocr: SlipOcrProvider;
  /** Opens the editor of one entry (the ✏️ on the card); absent -> no ✏️ button. */
  editUrl?: (txId: string) => string | undefined;
  /** Public https picture for the card header. */
  logoUrl?: string;
  /** What to say about a picture that is no slip. Absent -> the plain "not a slip" text. */
  onNotSlip?: () => Promise<LineMessage[]>;
  /**
   * After the entries are recorded: what the card carries below the rows (budget, warnings, the
   * "จ่ายด้วย" row) and the messages that follow it (points...). Absent -> a plain card.
   */
  extras?: (entries: TxRow[]) => Promise<SlipCardExtras>;
}

export interface SlipCardExtras {
  budgets?: NonNullable<Parameters<typeof buildReceiptCard>[0]["budgets"]>;
  cycleLabel?: string;
  notices?: NonNullable<Parameters<typeof buildReceiptCard>[0]["notices"]>;
  payment?: Parameters<typeof buildReceiptCard>[0]["payment"];
  /** Extra messages after the card (the referral bonus...). */
  after?: LineMessage[];
}

const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

async function alreadyRecorded(
  db: SupabaseClient,
  userId: string,
  slipId: string,
): Promise<LineMessage[]> {
  const tx = await findTransactionBySlip(db, userId, slipId);
  if (!tx) return [text(ALREADY_RECORDED_TEXT)];
  return [text(`${ALREADY_RECORDED_TEXT}\n${tx.title} ฿${formatBaht(toSatang(tx.amount))}`)];
}

/**
 * Slip image -> pending transaction + review card.
 * Order matters for cost and privacy: quota -> download -> dedupe by hash (before any AI call)
 * -> upload -> OCR -> sanitize -> dedupe by reference -> record.
 */
export async function handleSlipImage(
  deps: SlipDeps,
  user: UserRow,
  messageId: string,
): Promise<LineMessage[]> {
  const { db } = deps;
  const now = deps.now();

  // 1. quota (failed reads are never inserted, so they never count)
  const planRow = await getUserPlanRow(db, user.id);
  const plan = effectivePlan(planRow.plan, planRow.plan_expires_at, now);
  // Free: a few reads a week (a taste); past that the upgrade pitch. Failed reads are never
  // inserted, so they never count.
  let freeLeft: number | null = null;
  if (SLIP_LIMIT[plan] === 0) {
    const usedWeek = await countSlipsThisWeek(db, user.id, now);
    if (usedWeek >= FREE_SLIPS_PER_WEEK) {
      return upsellReply(db, user.id, now, "slip", SLIP_LOCKED_TEXT);
    }
    freeLeft = FREE_SLIPS_PER_WEEK - usedWeek - 1;
  }
  let recorded = false;
  const messages = await readSlip();
  return freeLeft !== null && recorded
    ? [...messages, text(SLIP_FREE_LEFT_TEXT(freeLeft))]
    : messages;

  async function readSlip(): Promise<LineMessage[]> {
    const used = await countSlipsThisMonth(db, user.id, now);
    const remaining = slipsRemaining(plan, used);
    if (freeLeft === null && remaining !== null && remaining <= 0) return [text(SLIP_QUOTA_TEXT)];
    // "unlimited" is normal use: past the fair-use ceiling the paid-per-use reading stops until the 1st
    if (plan === "ultimate" && used >= FAIR_USE.slips) {
      return [text(SLIP_FAIR_USE_TEXT(FAIR_USE.slips))];
    }

    // 2. download
    let image: SlipImage;
    try {
      image = await deps.fetchImage(messageId);
    } catch (error) {
      if (error instanceof ImageError) {
        return [text(error.reason === "too_large" ? IMAGE_TOO_LARGE_TEXT : IMAGE_ERROR_TEXT)];
      }
      throw error;
    }

    // 3. same picture sent before?
    const hash = sha256(image.bytes);
    const sameImage = await findSlipByHash(db, user.id, hash);
    if (sameImage) return alreadyRecorded(db, user.id, sameImage.id);

    // 4. private storage (path is scoped by user id)
    const path = `${user.id}/${hash}.${extensionFor(image.mimeType)}`;
    const upload = await db.storage
      .from(SLIP_BUCKET)
      .upload(path, image.bytes, { contentType: image.mimeType, upsert: true });
    if (upload.error) throw new Error(`upload slip: ${upload.error.message}`);

    const discardUpload = async () => {
      await db.storage.from(SLIP_BUCKET).remove([path]);
    };

    // 5. OCR + validation
    let result;
    try {
      result = sanitizeSlip(await deps.ocr.extract(image, { items: plan === "ultimate" }), now);
    } catch (error) {
      await discardUpload().catch(() => undefined);
      throw error;
    }
    if (!result.ok) {
      await discardUpload().catch(() => undefined);
      if (result.reason === "not_slip" && deps.onNotSlip) return deps.onNotSlip();
      return [text(result.reason === "not_slip" ? NOT_A_SLIP_TEXT : SLIP_UNREADABLE_TEXT)];
    }
    const data = result.data;

    // 6. same slip photographed again? (reference numbers are unique per user)
    if (data.reference) {
      const sameRef = await findSlipByRef(db, user.id, data.reference);
      if (sameRef) {
        await discardUpload().catch(() => undefined);
        return alreadyRecorded(db, user.id, sameRef.id);
      }
    }

    // 7. record the slip and its entries at once (every row has ✏️ / ❌ on the card)
    const slip = await insertSlip(db, { userId: user.id, storagePath: path, sha256: hash, data });
    if (!slip) {
      await discardUpload().catch(() => undefined);
      return [text(ALREADY_RECORDED_TEXT)];
    }

    recorded = true;
    const title = data.payeeName ?? data.memo ?? "โอนเงิน";
    const [categories, memory] = await Promise.all([
      loadCategories(db, user.id),
      loadMemoryFor(db, user, now),
    ]);
    const occurredAt = data.paidAt ?? now;

    // Elite reads the product lines of a receipt: one entry per line, adding up to the total (the
    // difference, VAT or service charge, is a line of its own). Everyone else: one entry.
    const split =
      plan === "ultimate" && data.kind === "receipt"
        ? planReceiptSplit(data.amountSatang, data.items)
        : null;
    const lines = split?.ok
      ? split.lines.map((l) => ({
          title: l.name,
          amountSatang: l.amountSatang,
          rule: l.name,
        }))
      : [
          {
            title,
            amountSatang: data.amountSatang,
            rule: [data.payeeName, data.memo].filter(Boolean).join(" ") || title,
          },
        ];

    const made: TxRow[] = [];
    const entries: ReceiptCardEntry[] = [];
    try {
      for (const line of lines) {
        const { categoryId } = categorizeByRules({
          title: line.rule,
          type: "expense",
          categories,
          memory,
        });
        const tx = await insertTransaction(db, {
          userId: user.id,
          type: "expense",
          title: line.title,
          amountSatang: line.amountSatang,
          categoryId,
          occurredAt,
          status: "confirmed",
          rawText: line.title,
          source: "slip",
          slipId: slip.id,
        });
        made.push(tx);
        const category = categories.find((c) => c.id === categoryId);
        entries.push({
          txId: tx.id,
          type: "expense",
          title: line.title,
          amountSatang: line.amountSatang,
          occurredAt,
          categoryName: category?.name ?? null,
          categoryIcon: category?.icon ?? null,
        });
      }
    } catch (error) {
      // part of the receipt got in: take it back so the person can send the photo again
      for (const t of made) {
        await updateTransaction(db, user.id, t.id, { status: "deleted" }).catch(() => undefined);
      }
      throw error;
    }

    let extras: SlipCardExtras = {};
    try {
      extras = (await deps.extras?.(made)) ?? {};
    } catch (error) {
      // what sits below the rows is a bonus: never lose the recorded entries over it
      log.error("slip_card_extras_failed", error);
    }
    return [
      buildReceiptCard({
        slipId: slip.id,
        entries,
        dateKnown: data.paidAt !== null,
        editUrl: deps.editUrl,
        logoUrl: deps.logoUrl,
        budgets: extras.budgets,
        cycleLabel: extras.cycleLabel,
        notices: extras.notices,
        payment: extras.payment,
      }),
      ...(extras.after ?? []),
    ];
  }
}
