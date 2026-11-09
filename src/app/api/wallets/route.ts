import { z } from "zod";
import { apiError, guard, json } from "@/lib/api";
import { requireUser } from "@/lib/auth/require-user";
import { sharedWalletCapacity, walletCapacity, PLAN_LABEL } from "@/lib/plan";
import { getPlanInfo } from "@/lib/plan-server";
import { LIMITS, limitOr429 } from "@/lib/rate-limit";
import { getAdminClient } from "@/lib/supabase/admin";
import {
  MAX_WALLET_NAME,
  parseOpeningBalance,
  ownedWallets,
  totalBalance,
  WALLET_KINDS,
  walletToDto,
} from "@/lib/wallet";
import { cardStatusToDto } from "@/lib/card";
import { createWallet, ensureWallets } from "@/lib/wallet-repo";
import { cardFieldsOr400 } from "@/lib/wallet-card-input";
import { createSharedWallet, membersOfMany, ownedSharedCount } from "@/lib/shared-wallet-repo";
import { requireFeature } from "@/lib/plan-server";
import { loadCardStatuses } from "@/lib/card-repo";
import { can } from "@/lib/plan";
import { t } from "@/lib/i18n";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/wallets — the person's wallets with balances (the main wallet is made on first use),
 * the total, and how many wallets their plan allows.
 */
export async function GET(request: Request): Promise<Response> {
  return guard(async () => {
    const auth = await requireUser(request);
    if (auth instanceof Response) return auth;
    const db = getAdminClient();
    const [wallets, { plan }] = await Promise.all([
      ensureWallets(db, auth.userId),
      getPlanInfo(db, auth.userId),
    ]);
    // the wallet limit counts the person's own wallets, not shared ones they were invited to
    const limit = walletCapacity(plan);
    const owned = ownedWallets(wallets, auth.userId);
    const sharedIds = wallets.filter((w) => w.shared).map((w) => w.id);
    const members = await membersOfMany(db, sharedIds);
    const cards = can(plan, "creditCard")
      ? await loadCardStatuses(db, auth.userId, wallets, new Date())
      : new Map();
    return json({
      items: wallets.map((w) => {
        const status = cards.get(w.id);
        return {
          ...walletToDto(w),
          card: status ? cardStatusToDto(status) : null,
          isOwner: w.ownerId === undefined || w.ownerId === auth.userId,
          members: w.shared ? (members.get(w.id) ?? []) : [],
        };
      }),
      totalSatang: totalBalance(wallets),
      limit,
      canAdd: owned.length < limit,
      canAddShared: can(plan, "sharedWallet"),
      /** The person asking (so the web app knows which member is them). */
      viewerId: auth.userId,
    });
  });
}

const createSchema = z.object({
  name: z.string().trim().min(1).max(MAX_WALLET_NAME),
  kind: z.enum(WALLET_KINDS).default("cash"),
  openingBalance: z.union([z.string(), z.number()]).nullable().optional(),
  isDefault: z.boolean().optional(),
  /** A wallet shared with other people (Pro and above). */
  shared: z.boolean().optional(),
  creditLimit: z.union([z.string(), z.number()]).nullable().optional(),
  statementDay: z.number().int().min(1).max(28).nullable().optional(),
  dueDay: z.number().int().min(1).max(28).nullable().optional(),
});

/** POST /api/wallets — add a wallet, within what the plan allows (Free 1, Pro 5). */
export async function POST(request: Request): Promise<Response> {
  return guard(async () => {
    const auth = await requireUser(request);
    if (auth instanceof Response) return auth;
    const db = getAdminClient();

    const limited = await limitOr429(db, "write", auth.userId, LIMITS.write);
    if (limited) return limited;

    const parsed = createSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return apiError(
        t("ตั้งชื่อกระเป๋าให้ถูกต้องนะ (ไม่เกิน {0} ตัวอักษร)", MAX_WALLET_NAME),
        400,
      );
    }
    const opening = parseOpeningBalance(parsed.data.openingBalance);
    if (opening === null) return apiError("ยอดตั้งต้นไม่ถูกต้อง", 400);

    const [wallets, { plan }] = await Promise.all([
      ensureWallets(db, auth.userId),
      getPlanInfo(db, auth.userId),
    ]);
    const capacity = walletCapacity(plan);
    if (ownedWallets(wallets, auth.userId).length >= capacity) {
      return Response.json(
        {
          error:
            plan === "free"
              ? "แผน Free มีกระเป๋าได้ 1 ใบ อัปเกรดเป็น Starter เพื่อมีได้ถึง 5 ใบนะ"
              : `แผน ${PLAN_LABEL[plan]} มีกระเป๋าได้สูงสุด ${capacity} ใบ`,
          upgrade: plan !== "ultimate",
        },
        { status: 403, headers: { "Cache-Control": "no-store" } },
      );
    }

    // a new shared wallet: Pro and above, never a card, never the main wallet
    if (parsed.data.shared) {
      const locked = await requireFeature(db, auth.userId, "sharedWallet");
      if (locked) return locked;
      if (parsed.data.kind === "card") return apiError("กระเป๋าร่วมเป็นบัตรเครดิตไม่ได้นะ", 400);
      if (parsed.data.isDefault) return apiError("กระเป๋าร่วมตั้งเป็นกระเป๋าหลักไม่ได้นะ", 400);
      if ((await ownedSharedCount(db, auth.userId)) >= sharedWalletCapacity(plan)) {
        return Response.json(
          {
            error:
              plan === "ultimate"
                ? `มีกระเป๋าร่วมได้สูงสุด ${sharedWalletCapacity(plan)} ใบ`
                : `แผน ${PLAN_LABEL[plan]} มีกระเป๋าร่วมได้ ${sharedWalletCapacity(plan)} ใบ อัปเกรดแผนเพื่อมีได้มากขึ้นนะ`,
            upgrade: plan !== "ultimate",
          },
          { status: 403, headers: { "Cache-Control": "no-store" } },
        );
      }
      const id = await createSharedWallet(db, auth.userId, {
        name: parsed.data.name,
        kind: parsed.data.kind,
        openingSatang: opening,
      });
      if (id === "duplicate") return apiError("มีกระเป๋าชื่อนี้อยู่แล้ว", 409);
      return json({ id, shared: true }, 201);
    }

    const card = await cardFieldsOr400(db, auth.userId, parsed.data, parsed.data.kind);
    if (card instanceof Response) return card;

    const result = await createWallet(db, auth.userId, {
      name: parsed.data.name,
      kind: parsed.data.kind,
      openingSatang: opening,
      makeDefault: parsed.data.isDefault === true,
      ...card,
    });
    if (result === "duplicate") return apiError("มีกระเป๋าชื่อนี้อยู่แล้ว", 409);
    return json({ id: result }, 201);
  });
}
