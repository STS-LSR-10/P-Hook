import { z } from "zod";
import { RESET_CONFIRM_PHRASE, monthDeletePhrase, phraseMatches } from "@/lib/account-confirm";
import { apiError, guard, json, readJson } from "@/lib/api";
import { requireUser } from "@/lib/auth/require-user";
import {
  eraseData,
  monthRange,
  monthsWithData,
  previewErase,
  type EraseScope,
} from "@/lib/data-reset";
import { log } from "@/lib/log";
import { LIMITS, limitOr429 } from "@/lib/rate-limit";
import { getAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const scopeSchema = z.discriminatedUnion("scope", [
  z.object({ scope: z.literal("all"), keepBalance: z.boolean().default(true) }),
  z.object({ scope: z.literal("month"), month: z.string().regex(/^\d{4}-\d{2}$/) }),
]);

function toScope(body: z.infer<typeof scopeSchema>): EraseScope | null {
  if (body.scope === "all") return { kind: "all", keepBalance: body.keepBalance };
  return monthRange(body.month) ? { kind: "month", month: body.month } : null;
}

/**
 * GET /api/account/erase?scope=all | scope=month&month=2026-10 — what an erase would remove (changes
 * nothing). With no scope: the months that have something to delete.
 */
export async function GET(request: Request): Promise<Response> {
  return guard(async () => {
    const auth = await requireUser(request);
    if (auth instanceof Response) return auth;
    const db = getAdminClient();
    const params = new URL(request.url).searchParams;

    if (!params.get("scope")) return json({ months: await monthsWithData(db, auth.userId) });

    const parsed = scopeSchema.safeParse({
      scope: params.get("scope"),
      keepBalance: true,
      month: params.get("month") ?? undefined,
    });
    const scope = parsed.success ? toScope(parsed.data) : null;
    if (!scope) return apiError("ตัวเลือกไม่ถูกต้อง", 400);
    return json(await previewErase(db, auth.userId, scope));
  });
}

const bodySchema = z.intersection(scopeSchema, z.object({ confirm: z.string().max(100) }));

/**
 * POST /api/account/erase { scope: "all", keepBalance, confirm } or { scope: "month", month, confirm }
 * — erase history for good, but keep the account, plan and set-up. The phrase is checked here too, so a
 * stray request cannot wipe anything.
 */
export async function POST(request: Request): Promise<Response> {
  return guard(async () => {
    const auth = await requireUser(request);
    if (auth instanceof Response) return auth;
    const db = getAdminClient();

    const limited = await limitOr429(db, "erase_data", auth.userId, LIMITS.eraseData);
    if (limited) return limited;

    const parsed = bodySchema.safeParse(await readJson(request));
    if (!parsed.success) return apiError("ข้อมูลไม่ถูกต้อง", 400);
    const scope = toScope(parsed.data);
    if (!scope) return apiError("เดือนไม่ถูกต้อง", 400);

    const phrase = scope.kind === "all" ? RESET_CONFIRM_PHRASE : monthDeletePhrase(scope.month);
    if (!phraseMatches(parsed.data.confirm, phrase)) {
      return apiError("พิมพ์ข้อความยืนยันให้ถูกต้องก่อนนะ", 400);
    }

    const result = await eraseData(db, auth.userId, scope);
    log.info("data_erased", {
      scope: scope.kind,
      entries: result.entries,
      files: result.filesRemoved,
    }); // counts only
    return json({ ok: true, ...result });
  });
}
