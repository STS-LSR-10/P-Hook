import { z } from "zod";
import { apiError, guard, json, readJson } from "@/lib/api";
import { requireUser } from "@/lib/auth/require-user";
import { getServerEnv } from "@/lib/env";
import { memberNames, upsertMember } from "@/lib/group-repo";
import { createLineClient } from "@/lib/line/client";
import { log } from "@/lib/log";
import { LIMITS, limitOr429 } from "@/lib/rate-limit";
import { MAX_BILL_MEMBERS, billShares } from "@/lib/split-bill";
import { billMembers, confirmBill, getBillAndGroup } from "@/lib/split-bill-repo";
import { getAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NAME_FALLBACK = "สมาชิกกลุ่ม";
/** Names fetched from LINE for ids it listed that we do not know yet, at most this many per visit. */
const MAX_NEW_PROFILES = 40;

type Db = ReturnType<typeof getAdminClient>;

/** The people who may share a bill: the members the bot knows, plus every member LINE will list. */
async function groupPeople(db: Db, group: { id: string; lineGroupId: string }, payer: string) {
  const known = await memberNames(db, group.id);
  let listed = false;
  try {
    const line = createLineClient(getServerEnv().LINE_CHANNEL_ACCESS_TOKEN);
    // only a verified / premium account may ask for the member list; otherwise this is null
    const ids = await line.listGroupMemberIds(group.lineGroupId);
    if (ids) {
      listed = true;
      let fetched = 0;
      for (const id of ids) {
        if (known.has(id) || fetched >= MAX_NEW_PROFILES) continue;
        fetched += 1;
        const profile = await line.getGroupMemberProfile(group.lineGroupId, id);
        const name = profile?.displayName?.trim() || NAME_FALLBACK;
        await upsertMember(db, group.id, id, name);
        known.set(id, { name, updatedAt: new Date().toISOString() });
      }
    }
  } catch (error) {
    log.warn("split_bill_member_list_failed", {
      reason: error instanceof Error ? error.message : "unknown",
    });
  }
  const people = [...known].map(([lineUserId, v]) => ({
    lineUserId,
    name: v.name,
    isPayer: lineUserId === payer,
  }));
  // the payer first, then by name
  people.sort(
    (a, b) => Number(b.isPayer) - Number(a.isPayer) || a.name.localeCompare(b.name, "th"),
  );
  return { people, listed };
}

async function loadFor(request: Request, id: string) {
  const auth = await requireUser(request);
  if (auth instanceof Response) return { error: auth } as const;
  const db = getAdminClient();
  const found = await getBillAndGroup(db, id);
  if (!found || !found.group.isActive) return { error: apiError("ไม่พบบิลนี้", 404) } as const;
  const { bill, group } = found;
  // only who paid the bill (or the owner of the group's ledger) chooses the people
  if (auth.lineUserId !== bill.payerLineUserId && auth.userId !== group.ownerUserId) {
    return { error: apiError("เฉพาะคนที่จ่ายบิลนี้เลือกคนหารได้นะ", 403) } as const;
  }
  return { db, bill, group, auth } as const;
}

/** GET /api/split-bill/<id> — the bill and the people who can share it (the payer ticks them on the LIFF page). */
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  return guard(async () => {
    const { id } = await context.params;
    const loaded = await loadFor(request, id);
    if ("error" in loaded) return loaded.error as Response;
    const { db, bill, group } = loaded;
    const [{ people, listed }, joined] = await Promise.all([
      groupPeople(db, group, bill.payerLineUserId),
      billMembers(db, bill.id),
    ]);
    // friends who tapped "ร่วมหารด้วย" are ticked in advance (the payer can untick them)
    const tapped = new Set(joined.map((m) => m.lineUserId));
    return json({
      bill: {
        id: bill.id,
        title: bill.title,
        amountSatang: bill.amountSatang,
        status: bill.status,
      },
      people: people.map((p) => ({ ...p, joined: tapped.has(p.lineUserId) })),
      /** true when LINE listed every member; false = only people the bot has seen in the group */
      complete: listed,
      /** the list can still be chosen */
      open: bill.status === "setup" || bill.status === "joining",
      maxPeople: MAX_BILL_MEMBERS,
    });
  });
}

const confirmSchema = z.object({ people: z.array(z.string().min(1).max(64)).min(1).max(60) });

/**
 * POST /api/split-bill/<id> { people } — fix the shares and start collecting. The page then writes a
 * short message in the group; the bot answers it with everybody's QR.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  return guard(async () => {
    const { id } = await context.params;
    const loaded = await loadFor(request, id);
    if ("error" in loaded) return loaded.error as Response;
    const { db, bill, group, auth } = loaded;

    const limited = await limitOr429(db, "write", auth.userId, LIMITS.write);
    if (limited) return limited;

    const parsed = confirmSchema.safeParse(await readJson(request));
    if (!parsed.success) return apiError("เลือกคนหารไม่ถูกต้อง", 400);
    if (bill.status !== "setup" && bill.status !== "joining") {
      return apiError("บิลนี้เลือกคนหารไปแล้ว", 409);
    }

    const { people } = await groupPeople(db, group, bill.payerLineUserId);
    const allowed = new Set(people.map((p) => p.lineUserId));
    const chosen = [...new Set([bill.payerLineUserId, ...parsed.data.people])];
    if (chosen.some((p) => !allowed.has(p))) return apiError("มีคนที่ไม่ได้อยู่ในกลุ่มนี้", 400);
    if (chosen.length < 2) return apiError("เลือกเพื่อนอย่างน้อย 1 คนนะ", 400);
    if (chosen.length > MAX_BILL_MEMBERS) return apiError("หารได้ไม่เกิน 30 คนต่อบิล", 400);

    const shares = billShares(bill.amountSatang, chosen, bill.payerLineUserId);
    if (!(await confirmBill(db, bill.id, shares))) return apiError("บิลนี้เลือกคนหารไปแล้ว", 409);
    const shortId = bill.id.slice(0, 8);
    return json({
      ok: true,
      count: chosen.length,
      /** what the page writes in the group so the bot puts the QR codes there */
      message: `✅ เลือกคนหารบิล ${bill.title} แล้ว #${shortId}`,
    });
  });
}
