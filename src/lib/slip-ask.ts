import type { SupabaseClient } from "@supabase/supabase-js";
import { categorizeByRules, matchLeadingCategory } from "@/lib/categorize/rules";
import {
  MEMORY_PLUS_HINT_TEXT,
  NOT_FOUND_TEXT,
  SLIP_ASK_DONE_TEXT,
  SLIP_ASK_SKIPPED_TEXT,
  text,
} from "@/lib/line/messages";
import { normalizeThaiDigits } from "@/lib/parse/thai-number";
import { can, effectivePlan } from "@/lib/plan";
import { getTransaction, loadCategories, loadMemoryFor, updateTransaction } from "@/lib/repo";
import type { UserRow } from "@/lib/repo";
import { clearSlipAsk } from "@/lib/slip-ask-repo";
import { getSlip, learnMerchant } from "@/lib/slip-repo";
import { t as tr } from "@/lib/i18n";
import type { LineMessage } from "@/lib/types";

const FALLBACK_NAME = "อื่นๆ";
const SKIP_RE = /^(?:ข้าม|ไม่รู้|ไม่ต้อง|ช่างมัน|ไม่เป็นไร|ไม่|ไม่ใช่|ยกเลิก|skip)$/i;

/** Could these typed words be the answer to "what was it for?" (short, no amount, no link)? */
export function looksLikeSlipAnswer(input: string): boolean {
  const t = input.trim();
  return (
    t.length > 0 && t.length <= 40 && !/\d/.test(normalizeThaiDigits(t)) && !/https?:/i.test(t)
  );
}

export const isSkipWord = (input: string): boolean => SKIP_RE.test(input.trim());

/** The answer is a tap on a category, or the words the person typed. */
export type SlipAnswer = { categoryId: string } | { typed: string } | { skip: true };

/**
 * Settle a transfer the bot asked about: file the entry in the chosen category (a typed answer also
 * becomes its title) and, for plans with merchant memory, remember "this recipient -> this category".
 */
export async function answerSlipAsk(
  deps: { db: SupabaseClient; now: () => Date },
  user: UserRow,
  txId: string,
  answer: SlipAnswer,
): Promise<LineMessage[] | null> {
  const { db } = deps;
  if ("skip" in answer) {
    await clearSlipAsk(db, user.id, txId);
    return [text(SLIP_ASK_SKIPPED_TEXT)];
  }

  const tx = await getTransaction(db, user.id, txId);
  if (!tx || tx.status === "deleted") {
    await clearSlipAsk(db, user.id, txId);
    // typed words go on as an ordinary message; a tap on a card that is gone says so
    return "typed" in answer ? null : [text(NOT_FOUND_TEXT)];
  }

  const [categories, memory] = await Promise.all([
    loadCategories(db, user.id),
    loadMemoryFor(db, user, deps.now()),
  ]);
  const expense = categories.filter((c) => c.type === tx.type && !c.is_hidden);
  let category: { id: string; name: string } | null = null;
  let title = tx.title;
  if ("categoryId" in answer) {
    category = expense.find((c) => c.id === answer.categoryId) ?? null;
    if (!category) return [text(NOT_FOUND_TEXT)];
  } else {
    const typed = answer.typed.trim();
    const lead = matchLeadingCategory(typed, tx.type, expense);
    if (lead) {
      category = lead;
      title = typed.slice(lead.name.length).trim() || tx.title;
    } else {
      const found = categorizeByRules({ title: typed, type: tx.type, categories, memory });
      // words that name nothing the bot knows are an answer only when they say "ค่า…": otherwise
      // they are ordinary chat ("โอเค", a question) and the question stays open
      if ((found.via === "fallback" || found.via === "none") && !typed.startsWith("ค่า")) {
        return null;
      }
      category = expense.find((c) => c.id === found.categoryId) ?? null;
      title = typed;
    }
  }

  await clearSlipAsk(db, user.id, txId);
  await updateTransaction(db, user.id, txId, {
    // nothing better found keeps the category it has
    ...(category ? { categoryId: category.id } : {}),
    ...(title !== tx.title ? { title } : {}),
  });
  const out: LineMessage[] = [text(SLIP_ASK_DONE_TEXT(title, category?.name ?? tr("ไม่ระบุหมวด")))];

  // a real category (not the catch-all) is worth remembering for the next transfer to this person
  if (category && category.name !== FALLBACK_NAME && tx.slip_id) {
    const slip = await getSlip(db, user.id, tx.slip_id);
    if (slip?.payee) {
      if (can(effectivePlan(user.plan, user.plan_expires_at, deps.now()), "merchantMemory")) {
        await learnMerchant(db, { userId: user.id, payee: slip.payee, categoryId: category.id });
        out.push(text(tr("จำไว้แล้ว: {0} → {1}", slip.payee, category.name)));
      } else {
        out.push(text(MEMORY_PLUS_HINT_TEXT));
      }
    }
  }
  return out;
}
