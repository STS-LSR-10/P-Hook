import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PaymentAccount } from "@/lib/split-bill-repo";
import { handleEvent, type HandlerDeps, type LineEvent } from "./handlers";

let account: PaymentAccount | null = null;
const saved: Partial<PaymentAccount>[] = [];

vi.mock("@/lib/repo", async (original) => ({
  ...(await original<typeof import("@/lib/repo")>()),
  ensureUser: async () => ({
    id: "u1",
    line_user_id: "U1",
    display_name: null,
    plan: "free",
    plan_expires_at: null,
  }),
}));
vi.mock("@/lib/split-bill-repo", () => ({
  getPayment: async () => account,
  savePayment: async (_db: unknown, _u: string, patch: Partial<PaymentAccount>) => {
    saved.push(patch);
    account = {
      promptpayId: null,
      bankName: null,
      bankAccount: null,
      accountName: null,
      ...account,
      ...patch,
    };
  },
}));

const say = (t: string): LineEvent => ({
  type: "message",
  replyToken: "rt",
  source: { type: "user", userId: "U" + "a".repeat(32) },
  message: { type: "text", id: "1", text: t },
});
async function run(t: string) {
  const reply = vi.fn<(token: string, messages: unknown[]) => Promise<undefined>>(
    async () => undefined,
  );
  const deps: HandlerDeps = {
    db: {} as SupabaseClient,
    reply,
    getProfile: async () => null,
    now: () => new Date("2026-10-18T05:00:00Z"),
    limit: async () => ({ allowed: true, hits: 1, limit: 30 }),
  };
  await handleEvent(say(t), deps);
  return JSON.stringify(reply.mock.calls.map((c) => c[1]));
}

beforeEach(() => {
  account = null;
  saved.length = 0;
});

describe("setting where to be paid (private chat, any plan)", () => {
  it("saves PromptPay and answers with the number hidden in part", async () => {
    const out = await run("พร้อมเพย์ 081-234-5678");
    expect(saved).toEqual([{ promptpayId: "0812345678" }]);
    expect(out).toContain("081-xxx-5678");
    expect(out).not.toContain("0812345678");
  });

  it("a national ID is saved, with a warning that the QR carries it in full", async () => {
    const out = await run("พร้อมเพย์ 1-2345-67890-12-3");
    expect(saved).toEqual([{ promptpayId: "1234567890123" }]);
    expect(out).toContain("เลขบัตรประชาชนจะอยู่ใน QR");
    // a phone number gets no such warning
    expect(await run("พร้อมเพย์ 0812345678")).not.toContain("เลขบัตรประชาชน");
  });

  it("a number that is not one explains the formats and saves nothing", async () => {
    const out = await run("พร้อมเพย์ 12345");
    expect(saved).toHaveLength(0);
    expect(out).toContain("เบอร์โทร 10 หลัก");
  });

  it("saves a bank account (bank, number, name) and says there is no QR for it", async () => {
    const out = await run("บัญชี กสิกร 123-4-56789-0 สมชาย ใจดี");
    expect(saved).toEqual([
      { bankName: "กสิกร", bankAccount: "123-4-56789-0", accountName: "สมชาย ใจดี" },
    ]);
    expect(out).toContain("ไม่มี QR สำหรับเลขบัญชี");
  });

  it("shows what is set (to its owner, in full) and what is not", async () => {
    expect(await run("พร้อมเพย์")).toContain("พร้อมเพย์: ยังไม่ได้ตั้ง");
    account = {
      promptpayId: "0812345678",
      bankName: "กสิกร",
      bankAccount: "123-4-56789-0",
      accountName: null,
    };
    const out = await run("พร้อมเพย์");
    expect(out).toContain("พร้อมเพย์: 0812345678");
    expect(out).toContain("บัญชี: กสิกร 123-4-56789-0");
  });

  it("each can be removed on its own", async () => {
    await run("พร้อมเพย์ ลบ");
    expect(saved[0]).toEqual({ promptpayId: null });
    await run("บัญชี ลบ");
    expect(saved[1]).toEqual({ bankName: null, bankAccount: null, accountName: null });
  });
});
