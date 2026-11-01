import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Owl } from "@/lib/ai/owl";
import { handleEvent, type HandlerDeps, type LineEvent } from "./handlers";

let live = false;
const waits: string[] = [];
const entries: string[] = [];

vi.mock("@/lib/repo", async (original) => ({
  ...(await original<typeof import("@/lib/repo")>()),
  ensureUser: async () => ({
    id: "u1",
    line_user_id: "U1",
    display_name: null,
    plan: "plus",
    plan_expires_at: null,
  }),
  getSettings: async () => ({
    confirm_style: "off",
    budget_cycle: "monthly",
    cycle_start_day: 1,
  }),
  loadCategories: async () => [],
  loadMemoryFor: async () => [],
  insertTransaction: async (_db: unknown, input: Record<string, unknown>) => {
    entries.push(String(input.title));
    return {
      id: "t1",
      status: input.status,
      type: input.type,
      title: input.title,
      amount: "1.00",
      occurred_at: new Date().toISOString(),
      category_id: null,
      slip_id: null,
    };
  },
}));
vi.mock("@/lib/user-reminder-repo", () => ({ listReminders: async () => [] }));
vi.mock("@/lib/ask-repo", () => ({
  startAskWait: async () => {
    waits.push("start");
  },
  clearAskWait: async () => {
    waits.push("clear");
  },
  isAskWaitLive: async () => live,
}));

const asked: string[] = [];
vi.mock("./owl", async (original) => ({
  ...(await original<typeof import("./owl")>()),
  owlAsk: async (_d: unknown, _u: unknown, q: string, inMode: boolean) => {
    asked.push(`${inMode ? "mode" : "once"}:${q}`);
    return [{ type: "text", text: "คำตอบ" }];
  },
}));

const owl: Owl = { name: "t", answer: async () => "x" };
const say = (t: string): LineEvent => ({
  type: "message",
  replyToken: "rt",
  source: { type: "user", userId: "U" + "a".repeat(32) },
  message: { type: "text", id: "1", text: t },
});
const tap = (data: string): LineEvent => ({
  type: "postback",
  replyToken: "rt",
  source: { type: "user", userId: "U" + "a".repeat(32) },
  postback: { data },
});
function setup(withOwl = true) {
  const reply = vi.fn<(token: string, messages: unknown[]) => Promise<undefined>>(
    async () => undefined,
  );
  const deps: HandlerDeps = {
    db: {} as SupabaseClient,
    reply,
    getProfile: async () => null,
    now: () => new Date("2026-10-30T05:00:00Z"),
    limit: async () => ({ allowed: true, hits: 1, limit: 30 }),
    ...(withOwl ? { owl } : {}),
  };
  return { deps, reply };
}
const said = (reply: ReturnType<typeof setup>["reply"]) =>
  ((reply.mock.calls[0]?.[1] ?? []) as { text?: string }[]).map((m) => m.text).join("\n");

beforeEach(() => {
  live = false;
  waits.length = 0;
  entries.length = 0;
  asked.length = 0;
});

describe("พี่ฮูก in the chat", () => {
  it.each(["ถามพี่ฮูก", "พี่ฮูก", "ฮูก", "ถามฮูก"])("%s opens the mode", async (word) => {
    const { deps, reply } = setup();
    await handleEvent(say(word), deps);
    expect(waits).toEqual(["start"]);
    expect(said(reply)).toContain("พี่ฮูกมาแล้ว");
  });

  it("ฮูก followed by a question asks one question without opening the mode", async () => {
    const { deps, reply } = setup();
    await handleEvent(say("ฮูก เดือนนี้ใช้ไปเท่าไร"), deps);
    await handleEvent(say("ถามพี่ฮูก หมวดไหนเยอะสุด"), deps);
    expect(asked).toEqual(["once:เดือนนี้ใช้ไปเท่าไร", "once:หมวดไหนเยอะสุด"]);
    expect(waits).toHaveLength(0);
    expect(said(reply)).toBe("คำตอบ");
  });

  it("in the mode with no AI to sort it, a question is answered and a clear entry is recorded", async () => {
    live = true;
    const { deps } = setup();
    await handleEvent(say("เหลืองบเท่าไร"), deps);
    await handleEvent(say("กาแฟ 50"), deps);
    expect(asked).toEqual(["mode:เหลืองบเท่าไร"]);
    expect(entries).toHaveLength(1);
  });

  it("in the mode, a real command still works, and จบ leaves", async () => {
    live = true;
    const a = setup();
    await handleEvent(say("เตือน"), a.deps);
    expect(said(a.reply)).toContain("ยังไม่มีเตือน");
    expect(asked).toHaveLength(0);
    const b = setup();
    await handleEvent(say("จบ"), b.deps);
    expect(waits).toEqual(["clear"]);
    expect(said(b.reply)).toContain("กลับมาจดรายการตามปกติ");
  });

  it("outside the mode, text is an entry as always", async () => {
    const { deps } = setup();
    await handleEvent(say("กาแฟ 50"), deps);
    expect(asked).toHaveLength(0);
    expect(entries).toEqual(["กาแฟ"]);
  });

  it("the button under an answer ends the mode", async () => {
    live = true;
    const { deps, reply } = setup();
    await handleEvent(tap("a=owlx"), deps);
    expect(waits).toEqual(["clear"]);
    expect(said(reply)).toContain("กลับมาจดรายการตามปกติ");
  });

  it("without an AI key: not available, and nothing is ever taken for a question", async () => {
    live = true;
    const { deps, reply } = setup(false);
    await handleEvent(say("ถามพี่ฮูก"), deps);
    expect(said(reply)).toContain("ยังไม่เปิด");
    await handleEvent(say("กาแฟ 50"), deps);
    expect(entries).toEqual(["กาแฟ"]);
  });

  it("a name that only starts like it is still an entry", async () => {
    const { deps } = setup();
    await handleEvent(say("ฮูกกี้ 50"), deps);
    expect(asked).toHaveLength(0);
    expect(entries).toEqual(["ฮูกกี้"]);
  });
});

describe("opening the pages that are not on the menu", () => {
  it("answers with a card that has a button to the page", async () => {
    process.env.NEXT_PUBLIC_LIFF_ID = "1234-abcd";
    const { deps, reply } = setup();
    await handleEvent(say("หน้ารายการ"), deps);
    const json = JSON.stringify(reply.mock.calls[0]?.[1]);
    expect(json).toContain("https://liff.line.me/1234-abcd/transactions");
    await handleEvent(say("งบ"), deps);
    expect(JSON.stringify(reply.mock.calls[1]?.[1])).toContain("/budgets");
  });
});
