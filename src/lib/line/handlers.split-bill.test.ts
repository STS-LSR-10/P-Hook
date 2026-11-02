import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { billShares, type BillMemberRow, type BillRow } from "@/lib/split-bill";
import type { PaymentAccount } from "@/lib/split-bill-repo";
import { handleEvent, type HandlerDeps, type LineEvent } from "./handlers";

const GID = "C-bill-group";
const NOW = new Date("2026-10-18T05:00:00Z");
const NAMES: Record<string, string> = {
  Uanna: "แอน",
  Ubob: "บ๊อบ",
  Uchom: "ชมพู",
  Uowner: "เจ้าของ",
};

let group = { id: "g1", lineGroupId: GID, ownerUserId: "app-Uowner", isActive: true };
let ownerPlan = "ultimate";
let members = new Map<string, { name: string; updatedAt: string }>();
let bills: BillRow[] = [];
let billMembers: Record<string, (BillMemberRow & { joinedAt: number })[]> = {};
const payments = new Map<string, PaymentAccount>();
const usedSlips = new Set<string>();
const announced = new Set<string>();
const reminded = new Map<string, string>();
const usage = new Map<string, number>();
let seq = 0;
const slipImages: number[] = [];
let slipLimited = false;
let fetchFails = false;
let ocrFails = false;
let slipRaw: Record<string, unknown> = {};
let slipQr: string | null = null;

vi.mock("@/lib/repo", async (original) => ({
  ...(await original<typeof import("@/lib/repo")>()),
  ensureUser: async (_db: unknown, lineUserId: string) => ({
    id: `app-${lineUserId}`,
    line_user_id: lineUserId,
    display_name: null,
    plan: "ultimate",
    plan_expires_at: null,
  }),
}));
vi.mock("@/lib/group-repo", () => ({
  getGroup: async () => group,
  getOwner: async () => ({ lineUserId: "Uowner", plan: ownerPlan, planExpiresAt: null }),
  memberNames: async () => members,
  upsertMember: async (_db: unknown, _g: string, userId: string, name: string) => {
    members.set(userId, { name, updatedAt: NOW.toISOString() });
  },
  closeGroup: async () => undefined,
}));
vi.mock("@/lib/slip-qr", async (original) => ({
  ...(await original<typeof import("@/lib/slip-qr")>()),
  // the pictures in these tests are not real images: the QR on the slip is whatever the test says
  readQrText: () => slipQr,
}));
vi.mock("@/lib/split-bill-repo", () => ({
  createBill: async (
    _db: unknown,
    input: {
      groupId: string;
      payerLineUserId: string;
      title: string;
      amountSatang: number;
      status?: BillRow["status"];
    },
  ) => {
    if (bills.filter((b) => ["setup", "joining", "collecting"].includes(b.status)).length >= 10) {
      return "too_many";
    }
    const bill: BillRow = {
      id: `b${++seq}`,
      groupId: input.groupId,
      payerLineUserId: input.payerLineUserId,
      title: input.title,
      amountSatang: input.amountSatang,
      status: input.status ?? "joining",
      createdAt: NOW.toISOString(),
    };
    bills.push(bill);
    billMembers[bill.id] = [];
    return bill;
  },
  getBill: async (_db: unknown, _g: string, id: string) => bills.find((b) => b.id === id) ?? null,
  listBills: async (_db: unknown, _g: string, statuses: string[]) =>
    bills.filter((b) => statuses.includes(b.status)),
  latestBillBy: async (_db: unknown, _g: string, payer: string, statuses: string[]) =>
    bills.filter((b) => b.payerLineUserId === payer && statuses.includes(b.status)).at(-1) ?? null,
  billMembers: async (_db: unknown, id: string) => billMembers[id] ?? [],
  joinBill: async (_db: unknown, id: string, user: string) => {
    const bill = bills.find((b) => b.id === id);
    if (bill?.status !== "joining" && bill?.status !== "setup") return "closed";
    const list = billMembers[id] ?? (billMembers[id] = []);
    if (!list.some((m) => m.lineUserId === user)) {
      if (list.length >= 30) return "full";
      list.push({
        lineUserId: user,
        shareSatang: null,
        paid: false,
        qrToken: `tok-${id}-${user}`,
        joinedAt: list.length,
      });
    }
    return "ok";
  },
  confirmBill: async (
    _db: unknown,
    id: string,
    shares: { lineUserId: string; shareSatang: number; paid: boolean }[],
  ) => {
    const bill = bills.find((b) => b.id === id);
    if (!bill || (bill.status !== "setup" && bill.status !== "joining")) return false;
    expect(shares.reduce((s, x) => s + x.shareSatang, 0)).toBe(bill.amountSatang);
    billMembers[id] = shares.map((x, i) => ({
      lineUserId: x.lineUserId,
      shareSatang: x.shareSatang,
      paid: x.paid,
      qrToken: `tok-${id}-${x.lineUserId}`,
      joinedAt: i,
    }));
    bill.status = billMembers[id].every((m) => m.paid) ? "settled" : "collecting";
    return true;
  },
  markAnnounced: async (_db: unknown, id: string) => {
    const bill = bills.find((b) => b.id === id);
    if (!bill || !["collecting", "settled"].includes(bill.status) || announced.has(id))
      return false;
    announced.add(id);
    return true;
  },
  markReminded: async (_db: unknown, id: string, day: string) => {
    if (reminded.get(id) === day) return false;
    reminded.set(id, day);
    return true;
  },
  findBillByShortId: async (_db: unknown, _g: string, short: string) =>
    bills.find((b) => b.id.startsWith(short)) ?? null,
  closeBill: async (
    _db: unknown,
    id: string,
    shares: { lineUserId: string; shareSatang: number; paid: boolean }[],
  ) => {
    const bill = bills.find((b) => b.id === id);
    if (bill?.status !== "joining") return false;
    expect(shares.reduce((s, x) => s + x.shareSatang, 0)).toBe(bill.amountSatang);
    for (const s of shares) {
      const m = billMembers[id]?.find((x) => x.lineUserId === s.lineUserId);
      if (m) {
        m.shareSatang = s.shareSatang;
        m.paid = s.paid;
      }
    }
    bill.status = billMembers[id]?.every((m) => m.paid) ? "settled" : "collecting";
    return true;
  },
  markPaid: async (_db: unknown, id: string, user: string) => {
    const bill = bills.find((b) => b.id === id);
    const m = billMembers[id]?.find((x) => x.lineUserId === user);
    if (bill?.status !== "collecting" || !m) return "none";
    if (m.paid) return "already";
    m.paid = true;
    m.claimed = false;
    m.claimVia = null;
    if (billMembers[id]?.every((x) => x.paid)) bill.status = "settled";
    return "ok";
  },
  cancelBill: async (_db: unknown, id: string) => {
    const bill = bills.find((b) => b.id === id);
    if (!bill || !["setup", "joining", "collecting"].includes(bill.status)) return false;
    bill.status = "cancelled";
    return true;
  },
  getPaymentByLine: async (_db: unknown, line: string) => payments.get(line) ?? null,
  claimPaid: async (_db: unknown, id: string, user: string) => {
    const bill = bills.find((b) => b.id === id);
    const m = billMembers[id]?.find((x) => x.lineUserId === user);
    if (bill?.status !== "collecting" || !m) return "none";
    if (m.paid || m.claimed) return "already";
    m.claimed = true;
    return "ok";
  },
  unpay: async (_db: unknown, id: string, user: string) => {
    const bill = bills.find((b) => b.id === id);
    const m = billMembers[id]?.find((x) => x.lineUserId === user);
    if (!bill || !m || !m.paid || user === bill.payerLineUserId) return "none";
    m.paid = false;
    m.paidVia = null;
    bill.status = "collecting";
    return "ok";
  },
  slipUsed: async (
    _db: unknown,
    keys: { sha256?: string | null; qrHash?: string | null; reference?: string | null },
  ) =>
    (!!keys.sha256 && usedSlips.has(`sha:${keys.sha256}`)) ||
    (!!keys.qrHash && usedSlips.has(`qr:${keys.qrHash}`)) ||
    (!!keys.reference && usedSlips.has(`ref:${keys.reference}`)),
  openSharesOf: async (_db: unknown, _g: string, user: string) =>
    bills
      .filter((b) => b.status === "collecting")
      .flatMap((bill) => {
        const m = billMembers[bill.id]?.find((x) => x.lineUserId === user);
        return m && !m.paid && m.shareSatang !== null ? [{ bill, shareSatang: m.shareSatang }] : [];
      }),
  claimBySlip: async (
    _db: unknown,
    input: {
      billId: string;
      lineUserId: string;
      sha256: string;
      reference: string | null;
      receiverVerified: boolean;
      qrHash?: string | null;
    },
  ) => {
    const bill = bills.find((b) => b.id === input.billId);
    const m = billMembers[input.billId]?.find((x) => x.lineUserId === input.lineUserId);
    if (bill?.status !== "collecting" || !m) return "none";
    if (m.paid || m.claimVia) return "already";
    if (
      usedSlips.has(`sha:${input.sha256}`) ||
      (input.reference && usedSlips.has(`ref:${input.reference}`)) ||
      (input.qrHash && usedSlips.has(`qr:${input.qrHash}`))
    ) {
      return "duplicate";
    }
    usedSlips.add(`sha:${input.sha256}`);
    if (input.reference) usedSlips.add(`ref:${input.reference}`);
    if (input.qrHash) usedSlips.add(`qr:${input.qrHash}`);
    // a checked slip leaves the share WAITING: only the payer's confirmation makes it paid
    m.claimed = true;
    m.claimVia = input.receiverVerified ? "slip" : "slip_unverified";
    return "ok";
  },
}));

const inGroup = (userId: string | undefined, t: string): LineEvent => ({
  type: "message",
  replyToken: "rt",
  source: { type: "group", groupId: GID, userId },
  message: { type: "text", id: "1", text: t },
});
const photo = (userId: string | undefined): LineEvent => ({
  type: "message",
  replyToken: "rt",
  source: { type: "group", groupId: GID, userId },
  message: { type: "image", id: "img1" },
});
const tap = (userId: string, data: string): LineEvent => ({
  type: "postback",
  replyToken: "rt",
  source: { type: "group", groupId: GID, userId },
  postback: { data },
});

function setup() {
  const reply = vi.fn<(token: string, messages: unknown[]) => Promise<undefined>>(
    async () => undefined,
  );
  const deps: HandlerDeps = {
    db: {
      rpc: async (fn: string, args: Record<string, unknown>) => {
        const key = `${args.p_kind}|${args.p_month}`;
        if (fn === "take_usage") {
          const used = usage.get(key) ?? 0;
          if (used >= (args.p_limit as number)) return { data: false, error: null };
          usage.set(key, used + 1);
          return { data: true, error: null };
        }
        usage.set(key, Math.max(0, (usage.get(key) ?? 0) - 1));
        return { data: null, error: null };
      },
    } as unknown as SupabaseClient,
    reply,
    getProfile: async () => null,
    getGroupMemberProfile: async (_g, u) => ({ displayName: NAMES[u] ?? "ใครสักคน" }),
    now: () => NOW,
    limit: async (bucket) => ({
      allowed: !(bucket === "group_slip" && slipLimited),
      hits: 1,
      limit: 30,
    }),
    slip: {
      fetchImage: async () => {
        if (fetchFails) throw new Error("download failed");
        return { bytes: new Uint8Array([slipImages.length, 1, 2, 3]), mimeType: "image/jpeg" };
      },
      ocr: {
        name: "fake",
        extract: async () => {
          slipImages.push(1);
          if (ocrFails) throw new Error("model down");
          return slipRaw;
        },
      } as never,
    },
  };
  return { deps, reply };
}
const said = (reply: ReturnType<typeof setup>["reply"]) =>
  JSON.stringify(reply.mock.calls.map((c) => c[1]));
const run = async (event: LineEvent) => {
  const s = setup();
  await handleEvent(event, s.deps);
  return said(s.reply);
};

beforeEach(() => {
  process.env.APP_BASE_URL = "https://x.test";
  group = { id: "g1", lineGroupId: GID, ownerUserId: "app-Uowner", isActive: true };
  ownerPlan = "ultimate";
  members = new Map(
    ["Uanna", "Ubob", "Uchom", "Uowner"].map((id) => [
      id,
      { name: NAMES[id] as string, updatedAt: NOW.toISOString() },
    ]),
  );
  bills = [];
  billMembers = {};
  payments.clear();
  usedSlips.clear();
  announced.clear();
  reminded.clear();
  usage.clear();
  slipImages.length = 0;
  slipLimited = false;
  fetchFails = false;
  ocrFails = false;
  slipRaw = {};
  slipQr = null;
  seq = 0;
});

/** A bill that Anna paid for, shared with Bob and Chom: names typed after the amount are the list. */
async function openBill(amount = 1200) {
  await run(inGroup("Uanna", `หารบิล หมูกระทะ ${amount} บ๊อบ ชมพู`));
}

describe("opening a bill", () => {
  it("'หารบิล 1200' posts a setup card: pick the people on the LIFF page, everyone, or let friends join themselves", async () => {
    process.env.NEXT_PUBLIC_LIFF_ID = "1234567890-abcdefgh";
    const out = await run(inGroup("Uanna", "หารบิล 1200 หมูกระทะ"));
    expect(out).toContain('"type":"flex"');
    expect(out).toContain("หมูกระทะ");
    expect(out).toContain("฿1,200");
    expect(out).toContain("https://liff.line.me/1234567890-abcdefgh/split-bill/b1"); // the people picker
    expect(out).toContain("a=gba&b=b1"); // ทั้งหมดเลย
    expect(out).toContain("a=gbn&b=b1"); // send the QR codes (the fallback after the LIFF page)
    expect(out).toContain("a=gbj&b=b1"); // 🙋 ร่วมหารด้วย: friends can add themselves while the payer chooses
    expect(bills[0]).toMatchObject({
      payerLineUserId: "Uanna",
      amountSatang: 120_000,
      status: "setup",
    });
    expect(billMembers.b1).toEqual([]);
  });

  it("'หาร บิล' with a space and 'แบ่งบิล' mean the same", async () => {
    await run(inGroup("Uanna", "หาร บิล ชาบู 600"));
    await run(inGroup("Uanna", "แบ่งบิล ขนม 100"));
    expect(bills.map((b) => b.title)).toEqual(["ชาบู", "ขนม"]);
  });

  it("without a LIFF id the card still works through the 'everyone' button", async () => {
    delete process.env.NEXT_PUBLIC_LIFF_ID;
    const out = await run(inGroup("Uanna", "หารบิล 1200 หมูกระทะ"));
    expect(out).not.toContain("liff.line.me");
    expect(out).toContain("a=gba&b=b1");
  });

  it("names typed after the amount are the list at once: shares are fixed and the QR codes go out", async () => {
    payments.set("Uanna", {
      promptpayId: "0812345678",
      bankName: null,
      bankAccount: null,
      accountName: null,
    });
    const out = await run(inGroup("Uanna", "หารบิล หมูกระทะ 1200 บ๊อบ ชมพู"));
    expect(bills[0]?.status).toBe("collecting");
    expect(billMembers.b1?.map((m) => m.lineUserId).sort()).toEqual(["Uanna", "Ubob", "Uchom"]);
    expect(out).toContain("📣 หารบิล"); // the header
    expect(out).toContain('"type":"carousel"'); // one QR per person who owes
    expect(out).toContain("/api/split-bill/qr/tok-b1-Ubob.png");
    expect(out).toContain("/api/split-bill/qr/tok-b1-Uchom.png");
    expect(out).not.toContain("tok-b1-Uanna"); // the payer owes nobody
    expect(out).toContain("฿400");
  });

  it("'ทั้งหมด' (or 'ทุกคน') means everyone the bot knows in the group", async () => {
    await run(inGroup("Uanna", "หารบิล หมูกระทะ 1200 ทั้งหมด"));
    expect(billMembers.b1?.map((m) => m.lineUserId).sort()).toEqual([
      "Uanna",
      "Ubob",
      "Uchom",
      "Uowner",
    ]);
    await run(inGroup("Uanna", "หารบิล 400 ขนม ทุกคน"));
    expect(billMembers.b2).toHaveLength(4);
  });

  it("a name the bot does not know opens nothing and says so", async () => {
    const out = await run(inGroup("Uanna", "หารบิล หมูกระทะ 1200 นก"));
    expect(out).toContain("ไม่รู้จัก นก");
    expect(bills).toHaveLength(0);
  });

  it("without an amount it explains how", async () => {
    expect(await run(inGroup("Uanna", "หารบิล หมูกระทะ"))).toContain("หารบิล หมูกระทะ 1200");
    expect(bills).toHaveLength(0);
  });

  it("needs the ledger to be open, and a writable one", async () => {
    group = { ...group, isActive: false };
    expect(await run(inGroup("Uanna", "หารบิล หมูกระทะ 1200"))).toContain("ยังไม่ได้เปิดสมุด");
    group = { ...group, isActive: true };
    ownerPlan = "free";
    expect(await run(inGroup("Uanna", "หารบิล หมูกระทะ 1200"))).toContain("หยุดจดชั่วคราว");
    expect(bills).toHaveLength(0);
  });

  it("at most ten unfinished bills a group", async () => {
    for (const letter of "กขคงจฉชซฌญ") await run(inGroup("Uanna", `หารบิล บิล${letter} 100`));
    expect(await run(inGroup("Uanna", "หารบิล อีกบิล 100"))).toContain("ครบ 10 บิล");
    expect(bills).toHaveLength(10);
  });
});

describe("choosing the people", () => {
  beforeEach(async () => {
    await run(inGroup("Uanna", "หารบิล หมูกระทะ 900"));
  });

  it("friends can tap 'ร่วมหารด้วย' while the payer is choosing: counted once each, payer included in the count", async () => {
    expect(await run(tap("Ubob", "a=gbj&b=b1"))).toContain("บ๊อบ ร่วมหาร");
    const again = await run(tap("Ubob", "a=gbj&b=b1"));
    expect(again).toContain("ตอนนี้ 2 คน"); // Bob and the payer; a second tap adds nobody
    expect(await run(tap("Uchom", "a=gbj&b=b1"))).toContain("ตอนนี้ 3 คน");
    expect(billMembers.b1?.map((m) => m.lineUserId).sort()).toEqual(["Ubob", "Uchom"]);
    expect(bills[0]?.status).toBe("setup");
  });

  it("the payer's choice wins: those who tapped but were left out are off the bill", async () => {
    await run(tap("Ubob", "a=gbj&b=b1"));
    await run(tap("Uchom", "a=gbj&b=b1"));
    // the payer's page confirms with only Chom and the payer
    const { confirmBill } = await import("@/lib/split-bill-repo");
    await confirmBill({} as never, "b1", billShares(90_000, ["Uchom"], "Uanna") as never);
    expect(billMembers.b1?.map((m) => m.lineUserId).sort()).toEqual(["Uanna", "Uchom"]);
  });

  it("once the payer has chosen, nobody can join any more", async () => {
    await run(tap("Uanna", "a=gba&b=b1"));
    expect(await run(tap("Ubob", "a=gbj&b=b1"))).toContain("ล็อกรายชื่อแล้ว");
  });

  it("'ทั้งหมดเลย' (payer only) fixes the shares among everyone known and sends the QR codes", async () => {
    expect(await run(tap("Ubob", "a=gba&b=b1"))).toContain("เฉพาะคนที่จ่ายบิลนี้");
    expect(bills[0]?.status).toBe("setup");
    const out = await run(tap("Uanna", "a=gba&b=b1"));
    expect(bills[0]?.status).toBe("collecting");
    expect(billMembers.b1).toHaveLength(4);
    const shares = billMembers.b1?.map((m) => m.shareSatang as number) ?? [];
    expect(shares.reduce((x, y) => x + y, 0)).toBe(90_000);
    expect(out).toContain("📣 หารบิล");
  });

  it("with only the payer known there is nobody to share with, and it says what to do", async () => {
    members = new Map([["Uanna", { name: "แอน", updatedAt: NOW.toISOString() }]]);
    const out = await run(tap("Uanna", "a=gba&b=b1"));
    expect(out).toContain("พิมพ์อะไรสักอย่างในกลุ่มก่อน");
    expect(bills[0]?.status).toBe("setup");
  });

  it("the LIFF page's message ('✅ เลือกคนหารบิล … #id') makes the bot send the QR codes: payer only, once", async () => {
    // the page's API has fixed the shares already, so the bill is collecting but not announced
    bills[0]!.id = "abcdef12-0000-0000-0000-000000000000";
    billMembers[bills[0]!.id] = [
      { lineUserId: "Uanna", shareSatang: 30_000, paid: true, qrToken: "tA", joinedAt: 0 },
      { lineUserId: "Ubob", shareSatang: 30_000, paid: false, qrToken: "tB", joinedAt: 1 },
      { lineUserId: "Uchom", shareSatang: 30_000, paid: false, qrToken: "tC", joinedAt: 2 },
    ];
    bills[0]!.status = "collecting";
    const message = "✅ เลือกคนหารบิล หมูกระทะ แล้ว #abcdef12";
    expect(await run(inGroup("Ubob", message))).toBe("[]"); // not the payer: quiet
    const out = await run(inGroup("Uanna", message));
    expect(out).toContain("📣 หารบิล");
    expect(await run(inGroup("Uanna", message))).toBe("[]"); // already sent: quiet
  });

  it("the 'ส่ง QR เข้ากลุ่ม' button works as the fallback, and before choosing it says to choose first", async () => {
    expect(await run(tap("Uanna", "a=gbn&b=b1"))).toContain("ยังไม่ได้เลือกคนหาร");
    await run(tap("Uanna", "a=gba&b=b1"));
    expect(await run(tap("Uanna", "a=gbn&b=b1"))).toContain("ส่ง QR เข้ากลุ่มไปแล้ว");
  });

  it("the payer can cancel; others cannot", async () => {
    expect(await run(tap("Ubob", "a=gbx&b=b1"))).toContain("เฉพาะคนที่จ่ายบิลนี้");
    expect(await run(tap("Uanna", "a=gbx&b=b1"))).toContain("ยกเลิกบิล");
    expect(bills[0]?.status).toBe("cancelled");
  });

  it("when the payer has set no account the QR step asks them to instead of sending empty cards", async () => {
    const out = await run(tap("Uanna", "a=gba&b=b1"));
    expect(out).toContain("พร้อมเพย์ 0812345678");
    expect(out).not.toContain('"type":"carousel"');
  });

  it("billShares: a bill that does not divide still adds up to the satang, the payer taking the odd one", () => {
    const shares = billShares(10_000, ["Ubob", "Uchom", "Uanna"], "Uanna");
    expect(shares.map((s) => s.shareSatang)).toEqual([3334, 3333, 3333]);
    expect(shares.reduce((s, x) => s + x.shareSatang, 0)).toBe(10_000);
    expect(shares[0]).toMatchObject({ lineUserId: "Uanna", paid: true });
  });
});

describe("the daily reminder (free: it rides on ordinary chat)", () => {
  const AT_ELEVEN = new Date("2026-10-18T04:00:00Z"); // 11:00 in Bangkok
  const AT_EIGHT = new Date("2026-10-18T01:00:00Z"); // 08:00 in Bangkok

  async function chat(userId: string, now: Date, textIn = "หิวจัง") {
    const s = setup();
    s.deps.now = () => now;
    await handleEvent(inGroup(userId, textIn), s.deps);
    return said(s.reply);
  }

  beforeEach(async () => {
    await openBill(900);
  });

  it("the first ordinary message of the day after 10:00 gets the card of who has not paid", async () => {
    const out = await chat("Ubob", AT_ELEVEN);
    expect(out).toContain("เตือนประจำวัน");
    expect(out).toContain("บ๊อบ");
    expect(out).toContain("ชมพู");
    expect(out).toContain('"text":"บ๊อบ"');
    expect(out).not.toContain('"text":"แอน"'); // the payer owes nothing, so there is no row for them
  });

  it("only once a day: the next messages are left alone, tomorrow it is due again", async () => {
    expect(await chat("Ubob", AT_ELEVEN)).toContain("เตือนประจำวัน");
    expect(await chat("Uchom", AT_ELEVEN)).toBe("[]");
    const tomorrow = new Date(AT_ELEVEN.getTime() + 86_400_000);
    expect(await chat("Uchom", tomorrow)).toContain("เตือนประจำวัน");
  });

  it("counts each reminder sent against the owner's month, and stops at 200", async () => {
    expect(await chat("Ubob", AT_ELEVEN)).toContain("เตือนประจำวัน");
    expect(usage.get("group_remind|2026-10-01")).toBe(1);
    reminded.clear();
    usage.set("group_remind|2026-10-01", 200);
    expect(await chat("Ubob", AT_ELEVEN)).toBe("[]");
    expect(usage.get("group_remind|2026-10-01")).toBe(200);
  });

  it("not before 10:00", async () => {
    expect(await chat("Ubob", AT_EIGHT)).toBe("[]");
    expect(await chat("Ubob", AT_ELEVEN)).toContain("เตือนประจำวัน"); // and then it still comes, later that day
  });

  it("only people who have not paid are listed; nothing at all once everybody has", async () => {
    await run(tap("Uanna", "a=gbp&b=b1&u=Ubob"));
    const one = await chat("Ubob", AT_ELEVEN);
    expect(one).toContain("ชมพู");
    expect(one).not.toContain("บ๊อบ");
    reminded.clear();
    await run(tap("Uanna", "a=gbp&b=b1&u=Uchom"));
    expect(await chat("Ubob", AT_ELEVEN)).toBe("[]");
  });

  it("a command is answered as a command (no reminder on top), and a bill nobody settles stops after 30 days", async () => {
    expect(await chat("Ubob", AT_ELEVEN, "บิลค้าง")).not.toContain("เตือนประจำวัน");
    const old = new Date(AT_ELEVEN.getTime() + 31 * 86_400_000);
    expect(await chat("Ubob", old)).toBe("[]");
  });

  it("a read-only ledger (the owner's plan ended) sends no reminders", async () => {
    ownerPlan = "free";
    expect(await chat("Ubob", AT_ELEVEN)).toBe("[]");
  });
});

const slipOf = (over: Record<string, unknown> = {}) => ({
  is_slip: true,
  kind: "transfer",
  amount: 300,
  paid_at: "2026-10-18T12:05:00+07:00",
  payee_name: "แอน ใจดี",
  payee_account: "xxx-x-x5678-x",
  reference: "REF123456",
  ...over,
});

describe("paying", () => {
  beforeEach(async () => {
    await openBill(900);
  });

  it("gives each person a QR with their own amount, from the payer's PromptPay", async () => {
    payments.set("Uanna", {
      promptpayId: "0812345678",
      bankName: null,
      bankAccount: null,
      accountName: null,
    });
    const out = await run(tap("Ubob", "a=gbq&b=b1"));
    const token = billMembers.b1?.find((m) => m.lineUserId === "Ubob")?.qrToken;
    expect(out).toContain("ส่วนของ บ๊อบ");
    expect(out).toContain("฿300");
    expect(out).toContain(`/api/split-bill/qr/${token}.png`.replace(/^/, ""));
    expect(out).toContain("081-xxx-5678"); // masked, never the whole number
    expect(out).not.toContain("0812345678");
  });

  it("without a public https address there is no picture, only the details", async () => {
    payments.set("Uanna", {
      promptpayId: "0812345678",
      bankName: null,
      bankAccount: null,
      accountName: null,
    });
    const prev = process.env.APP_BASE_URL;
    delete process.env.APP_BASE_URL;
    try {
      expect(await run(tap("Ubob", "a=gbq&b=b1"))).not.toContain('"type":"image"');
    } finally {
      if (prev !== undefined) process.env.APP_BASE_URL = prev;
    }
  });

  it("a bank account is shown as text (there is no QR for it)", async () => {
    process.env.APP_BASE_URL = "https://x.test";
    payments.set("Uanna", {
      promptpayId: null,
      bankName: "กสิกร",
      bankAccount: "123-4-56789-0",
      accountName: "แอน ใจดี",
    });
    const out = await run(tap("Ubob", "a=gbq&b=b1"));
    expect(out).toContain("กสิกร 123-4-56789-0");
    expect(out).toContain("แอน ใจดี");
    expect(out).not.toContain('"type":"image"');
  });

  it("tells the payer how to set it up when nothing is set", async () => {
    const out = await run(tap("Ubob", "a=gbq&b=b1"));
    expect(out).toContain("พร้อมเพย์ 0812345678");
  });

  it("someone not on the bill, or already paid, is told", async () => {
    expect(await run(tap("Uowner", "a=gbq&b=b1"))).toContain("ไม่ได้อยู่ในรายชื่อ");
    await run(tap("Uanna", "a=gbp&b=b1&u=Ubob"));
    expect(await run(tap("Ubob", "a=gbq&b=b1"))).toContain("จ่ายเรียบร้อยแล้ว");
  });

  it("only the payer ticks a person off; the card then shows it, and the last one settles the bill", async () => {
    expect(await run(tap("Ubob", "a=gbp&b=b1&u=Uchom"))).toContain("เฉพาะคนที่จ่ายบิลนี้");
    expect(billMembers.b1?.find((m) => m.lineUserId === "Uchom")?.paid).toBe(false);

    const first = await run(tap("Uanna", "a=gbp&b=b1&u=Ubob"));
    expect(first).toContain("รับเงินจาก บ๊อบ แล้ว");
    expect(first).toContain("ยังค้าง 1 คน");
    expect(await run(tap("Uanna", "a=gbp&b=b1&u=Ubob"))).toContain("จ่ายแล้วก่อนหน้านี้");

    const last = await run(inGroup("Uanna", "ได้รับแล้ว ชมพู"));
    expect(last).toContain("เก็บครบแล้ว");
    expect(bills[0]?.status).toBe("settled");
  });

  it("the typed 'ได้รับแล้ว' names someone who is not on the bill", async () => {
    expect(await run(inGroup("Uanna", "ได้รับแล้ว นก"))).toContain("ไม่เจอ นก");
  });
});

describe("chasing", () => {
  it("lists who still owes how much, bill by bill, and keeps working when the ledger is read-only", async () => {
    await openBill(900);
    await run(tap("Uanna", "a=gbp&b=b1&u=Ubob"));
    ownerPlan = "free";
    const out = await run(inGroup("Ubob", "ตามเงิน"));
    expect(out).toContain("ชมพู");
    expect(out).toContain("฿300");
    expect(out).not.toContain("บ๊อบ"); // already paid
  });

  it("says so when nobody owes anything", async () => {
    expect(await run(inGroup("Uanna", "ตามเงิน"))).toContain("ไม่มียอดค้าง");
  });

  it("บิลค้าง lists the unfinished bills in plain words", async () => {
    await openBill();
    await run(inGroup("Uanna", "หารบิล ขนม 100"));
    const out = await run(inGroup("Uanna", "บิลค้าง"));
    expect(out).toContain("หมูกระทะ");
    expect(out).toContain("ค้าง 2 คน"); // collecting: Bob and Chom have not paid
    expect(out).toContain("ขนม");
    expect(out).toContain("รอเลือกคนหาร"); // the one still being set up
  });
});

describe("private commands never answer in a group", () => {
  it("setting PromptPay in the group does nothing", async () => {
    expect(await run(inGroup("Uanna", "พร้อมเพย์ 0812345678"))).toBe("[]");
  });
});

describe("โอนแล้ว (a friend says they paid)", () => {
  beforeEach(async () => {
    await openBill(900);
  });

  it("the button marks it waiting, asks the payer to confirm, and the card shows it", async () => {
    const out = await run(tap("Ubob", "a=gbm&b=b1"));
    expect(out).toContain("บ๊อบ แจ้งว่าโอน");
    expect(out).toContain("฿300");
    expect(out).toContain("a=gbp&b=b1&u=Ubob"); // one tap for the payer to confirm
    expect(billMembers.b1?.find((m) => m.lineUserId === "Ubob")).toMatchObject({
      claimed: true,
      paid: false,
    });
    const card = await run(inGroup("Uanna", "ตามเงิน"));
    expect(card).toContain("บ๊อบ"); // still owes until the payer confirms
  });

  it("the payer's tick then makes it paid; saying it twice does nothing new", async () => {
    await run(tap("Ubob", "a=gbm&b=b1"));
    expect(await run(tap("Ubob", "a=gbm&b=b1"))).toContain("แจ้งโอนไปแล้ว");
    await run(tap("Uanna", "a=gbp&b=b1&u=Ubob"));
    expect(billMembers.b1?.find((m) => m.lineUserId === "Ubob")?.paid).toBe(true);
  });

  it("the typed 'โอนแล้ว' works when there is one open bill; with two it points at the buttons", async () => {
    expect(await run(inGroup("Ubob", "โอนแล้ว"))).toContain("บ๊อบ แจ้งว่าโอน");
    await run(inGroup("Uanna", "หารบิล ขนม 600 บ๊อบ ชมพู"));
    expect(await run(inGroup("Uchom", "โอนแล้ว"))).toContain("หลายบิล");
  });

  it("someone with nothing to pay, or not on the bill, is told", async () => {
    expect(await run(inGroup("Uowner", "โอนแล้ว"))).toContain("ไม่มียอดค้าง");
    expect(await run(tap("Uowner", "a=gbm&b=b1"))).toContain("ไม่ได้อยู่ในรายชื่อ");
    await run(tap("Uanna", "a=gbp&b=b1&u=Ubob"));
    expect(await run(tap("Ubob", "a=gbm&b=b1"))).toContain("แจ้งโอนไปแล้ว");
  });

  it("the payer can take a tick back, nobody else can, and a settled bill goes back to collecting", async () => {
    await run(tap("Uanna", "a=gbp&b=b1&u=Ubob"));
    await run(tap("Uanna", "a=gbp&b=b1&u=Uchom"));
    expect(bills[0]?.status).toBe("settled");
    expect(await run(tap("Ubob", "a=gbu&b=b1&u=Uchom"))).toContain("เฉพาะคนที่จ่ายบิลนี้");
    expect(await run(tap("Uanna", "a=gbu&b=b1&u=Uchom"))).toContain("ยกเลิกการรับเงินจาก ชมพู");
    expect(bills[0]?.status).toBe("collecting");
    expect(billMembers.b1?.find((m) => m.lineUserId === "Uchom")?.paid).toBe(false);
    expect(await run(inGroup("Uanna", "ยังไม่ได้รับ บ๊อบ"))).toContain("ยกเลิกการรับเงินจาก บ๊อบ");
    expect(await run(tap("Uanna", "a=gbu&b=b1&u=Uanna"))).toContain("ยังไม่ได้ถูกติ๊ก"); // never the payer's own share
  });
});

describe("a slip sent into the group", () => {
  beforeEach(async () => {
    payments.set("Uanna", {
      promptpayId: "0812345678",
      bankName: null,
      bankAccount: null,
      accountName: null,
    });
    await openBill(900);
    slipRaw = slipOf();
  });

  it("a checked slip leaves the share WAITING: only the payer's tap makes it paid", async () => {
    const out = await run(photo("Ubob"));
    expect(out).toContain("ส่งสลิปส่วนของ");
    expect(out).toContain("บอทตรวจสลิปแล้ว");
    expect(out).toContain("a=gbp&b=b1&u=Ubob");
    expect(billMembers.b1?.find((m) => m.lineUserId === "Ubob")).toMatchObject({
      paid: false,
      claimed: true,
      claimVia: "slip",
    });
    expect(await run(tap("Uanna", "a=gbp&b=b1&u=Ubob"))).toContain("บ๊อบ");
    expect(billMembers.b1?.find((m) => m.lineUserId === "Ubob")).toMatchObject({
      paid: true,
      claimed: false,
      claimVia: null,
    });
  });

  it("the sender, other members and the ledger owner cannot confirm it", async () => {
    await run(photo("Ubob"));
    for (const who of ["Ubob", "Uchom", "Uowner"]) {
      expect(await run(tap(who, "a=gbp&b=b1&u=Ubob"))).toContain("กดได้เฉพาะคนที่จ่ายบิลนี้");
    }
    expect(billMembers.b1?.find((m) => m.lineUserId === "Ubob")?.paid).toBe(false);
  });

  it("an amount over the share is accepted and mentioned", async () => {
    slipRaw = slipOf({ amount: 500 });
    expect(await run(photo("Ubob"))).toContain("โอนเกินมา ฿200");
  });

  it("an amount under the share does not pay it", async () => {
    slipRaw = slipOf({ amount: 250 });
    const out = await run(photo("Ubob"));
    expect(out).toContain("ยอดยังไม่ครบ");
    expect(billMembers.b1?.find((m) => m.lineUserId === "Ubob")?.paid).toBe(false);
  });

  it("a receiver that is not the payer's account does not pay it", async () => {
    slipRaw = slipOf({ payee_account: "xxx-x-x9999-x" });
    const out = await run(photo("Ubob"));
    expect(out).toContain("ไม่ตรงกับของ แอน");
    expect(billMembers.b1?.find((m) => m.lineUserId === "Ubob")?.paid).toBe(false);
  });

  it("a receiver the slip does not show still waits for the payer, marked unverified", async () => {
    slipRaw = slipOf({ payee_account: null });
    const out = await run(photo("Ubob"));
    expect(out).toContain("อ่านผู้รับในสลิปไม่ได้");
    expect(out).toContain("a=gbp&b=b1&u=Ubob");
    expect(billMembers.b1?.find((m) => m.lineUserId === "Ubob")).toMatchObject({
      paid: false,
      claimVia: "slip_unverified",
    });
  });

  it("a payer with no account set cannot be checked either, and it is marked unverified", async () => {
    payments.clear();
    await run(photo("Ubob"));
    expect(billMembers.b1?.find((m) => m.lineUserId === "Ubob")?.claimVia).toBe("slip_unverified");
  });

  it("a slip made before the bill was opened cannot pay it", async () => {
    slipRaw = slipOf({ paid_at: "2026-10-17T09:00:00+07:00" });
    expect(await run(photo("Ubob"))).toContain("ทำก่อนเปิดบิล");
    expect(billMembers.b1?.find((m) => m.lineUserId === "Ubob")?.paid).toBe(false);
  });

  it("the same slip cannot pay twice, by picture or by the bank's reference", async () => {
    await run(photo("Ubob"));
    expect(await run(photo("Uchom"))).toContain("เคยใช้จ่ายไปแล้ว"); // same reference, another picture
    expect(billMembers.b1?.find((m) => m.lineUserId === "Uchom")?.paid).toBe(false);
  });

  it("pictures from people who owe nothing, and pictures that are not slips, get no answer at all", async () => {
    expect(await run(photo("Uowner"))).toBe("[]");
    expect(await run(photo(undefined))).toBe("[]");
    expect(slipImages).toHaveLength(0); // and nothing was read
    slipRaw = { is_slip: false };
    expect(await run(photo("Ubob"))).toBe("[]");
    expect(usage.get(`group_slip|2026-10-01`)).toBe(0); // the use was given back
  });

  it("a blurry slip says so and gives the use back; so do a failed download and a failed reading", async () => {
    slipRaw = { is_slip: true, kind: "transfer", amount: null };
    expect(await run(photo("Ubob"))).toContain("อ่านสลิปไม่ชัด");
    expect(usage.get(`group_slip|2026-10-01`)).toBe(0);
    fetchFails = true;
    expect(await run(photo("Ubob"))).toContain("โหลดรูปไม่สำเร็จ");
    fetchFails = false;
    ocrFails = true;
    expect(await run(photo("Ubob"))).toContain("อ่านสลิปไม่สำเร็จ");
    expect(usage.get(`group_slip|2026-10-01`)).toBe(0);
  });

  it("a read-only ledger, a busy sender and a used-up month do not read pictures", async () => {
    ownerPlan = "free";
    expect(await run(photo("Ubob"))).toBe("[]");
    ownerPlan = "ultimate";
    slipLimited = true;
    expect(await run(photo("Ubob"))).toBe("[]");
    slipLimited = false;
    usage.set("group_slip|2026-10-01", 300);
    expect(await run(photo("Ubob"))).toContain("ครบเกณฑ์แล้ว");
    expect(slipImages).toHaveLength(0);
  });

  it("the same slip cannot pay twice by the QR printed on it, even with another picture and another reference", async () => {
    slipQr = "000600000101030040220123456789ABCDEF5102TH9104E2D8";
    await run(photo("Ubob"));
    slipRaw = slipOf({ reference: "OTHER-REF-1" }); // a retyped / re-photographed copy reads differently
    expect(await run(photo("Uchom"))).toContain("เคยใช้จ่ายไปแล้ว");
    expect(billMembers.b1?.find((m) => m.lineUserId === "Uchom")?.paid).toBe(false);
    slipQr = "a-different-slip-qr";
    slipRaw = slipOf({ reference: "OTHER-REF-2" });
    expect(await run(photo("Uchom"))).toContain("บอทตรวจสลิปแล้ว");
    expect(billMembers.b1?.find((m) => m.lineUserId === "Uchom")?.claimed).toBe(true);
  });

  it("a slip with no QR we can read and no reference cannot be told from another: the payer confirms it", async () => {
    slipRaw = slipOf({ reference: null });
    slipQr = null;
    const out = await run(photo("Ubob"));
    expect(out).toContain("ตรวจกันสลิปซ้ำไม่ได้");
    expect(out).toContain("a=gbp&b=b1&u=Ubob"); // one tap for the payer
    expect(billMembers.b1?.find((m) => m.lineUserId === "Ubob")).toMatchObject({
      paid: false,
      claimed: true,
    });
    expect(usedSlips.size).toBe(0); // and nothing was recorded as a used slip
  });

  it("a slip with a QR but no reference is fine: the QR is the key", async () => {
    slipRaw = slipOf({ reference: null });
    slipQr = "qr-only-slip";
    expect(await run(photo("Ubob"))).toContain("บอทตรวจสลิปแล้ว");
  });

  it("the last share the payer confirms settles the bill", async () => {
    await run(photo("Ubob"));
    slipRaw = slipOf({ reference: "REF999999" });
    await run(photo("Uchom"));
    expect(bills[0]?.status).toBe("collecting"); // two checked slips, nothing confirmed yet
    await run(tap("Uanna", "a=gbp&b=b1&u=Ubob"));
    const out = await run(tap("Uanna", "a=gbp&b=b1&u=Uchom"));
    expect(out).toContain("เก็บครบแล้ว");
    expect(bills[0]?.status).toBe("settled");
  });
});
