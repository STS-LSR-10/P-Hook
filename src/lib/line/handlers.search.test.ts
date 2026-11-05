import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { handleEvent, type HandlerDeps, type LineEvent } from "./handlers";

let plan = "free";
let count = 3;
const totalsCalls: unknown[] = [];

vi.mock("@/lib/repo", async (original) => ({
  ...(await original<typeof import("@/lib/repo")>()),
  ensureUser: async () => ({
    id: "u1",
    line_user_id: "U1",
    display_name: null,
    plan,
    plan_expires_at: null,
  }),
}));
vi.mock("@/lib/note-repo", async (original) => ({
  ...(await original<typeof import("@/lib/note-repo")>()),
  listNotes: async () => ({ items: [], hasMore: false }),
}));
vi.mock("@/lib/search", async (original) => ({
  ...(await original<typeof import("@/lib/search")>()),
  loadSearchTotals: async (_db: unknown, _user: string, target: unknown) => {
    totalsCalls.push(target);
    return { incomeSatang: 10_000, expenseSatang: 10_550, count };
  },
  loadSearchItems: async () =>
    count === 0
      ? []
      : [
          {
            id: "t1",
            type: "expense",
            title: "กาแฟเย็น",
            amountSatang: 6000,
            occurredAt: "2026-10-10T05:00:00Z",
          },
        ],
}));

const say = (t: string): LineEvent => ({
  type: "message",
  replyToken: "rt",
  source: { type: "user", userId: "U" + "a".repeat(32) },
  message: { type: "text", id: "1", text: t },
});

function setup() {
  const reply = vi.fn<(token: string, messages: unknown[]) => Promise<undefined>>(
    async () => undefined,
  );
  const deps: HandlerDeps = {
    db: {} as SupabaseClient,
    reply,
    getProfile: async () => null,
    now: () => new Date("2026-10-17T08:00:00Z"),
    limit: async () => ({ allowed: true, hits: 1, limit: 30 }),
  };
  return { deps, reply };
}
const first = (reply: ReturnType<typeof setup>["reply"]) =>
  (reply.mock.calls[0]?.[1][0] ?? {}) as { type?: string; text?: string };

beforeEach(() => {
  plan = "free";
  count = 3;
  totalsCalls.length = 0;
  delete process.env.NEXT_PUBLIC_LIFF_ID;
  delete process.env.APP_BASE_URL;
});

describe("ค้นหา", () => {
  it("Free finds them too, with the totals left for Pro", async () => {
    const { deps, reply } = setup();
    await handleEvent(say("ค้นหา กาแฟ"), deps);
    expect(first(reply).text).toContain("พบ 3 รายการเงิน");
    expect(first(reply).text).toContain("Pro");
  });

  it.each(["plus", "ultimate"])("%s gets a result card for the words", async (p) => {
    plan = p;
    const { deps, reply } = setup();
    await handleEvent(say("ค้นหา กาแฟ"), deps);
    const json = JSON.stringify(first(reply));
    expect(first(reply).type).toBe("flex");
    expect(json).toContain("พบ 3 รายการ");
    expect(json).toContain("กาแฟเย็น");
    expect(totalsCalls[0]).toEqual({ q: "กาแฟ", tag: null });
  });

  it("a #word searches the tag", async () => {
    plan = "plus";
    const { deps } = setup();
    await handleEvent(say("ค้นหา #ปาร์ตี้"), deps);
    expect(totalsCalls[0]).toEqual({ q: null, tag: "ปาร์ตี้" });
  });

  it("says so in text when nothing matches", async () => {
    plan = "plus";
    count = 0;
    const { deps, reply } = setup();
    await handleEvent(say("ค้นหา ทุเรียน"), deps);
    expect(first(reply).type).toBe("text");
    expect(first(reply).text).toContain("ไม่พบรายการ");
  });

  it("with no word it shows how to search", async () => {
    plan = "plus";
    const { deps, reply } = setup();
    await handleEvent(say("ค้นหา"), deps);
    expect(first(reply).text).toContain("ค้นหา กาแฟ");
    expect(totalsCalls).toHaveLength(0);
  });

  it("the button opens the list with the search through the LIFF link", async () => {
    plan = "plus";
    process.env.NEXT_PUBLIC_LIFF_ID = "1234-abcd";
    const { deps, reply } = setup();
    await handleEvent(say("ค้นหา #ปาร์ตี้"), deps);
    expect(JSON.stringify(first(reply))).toContain(
      `https://liff.line.me/1234-abcd/transactions?q=${encodeURIComponent("#ปาร์ตี้")}`,
    );
  });

  it("falls back to the app URL when there is no LIFF id", async () => {
    plan = "plus";
    process.env.APP_BASE_URL = "https://app.example.com/";
    const { deps, reply } = setup();
    await handleEvent(say("ค้นหา กาแฟ"), deps);
    expect(JSON.stringify(first(reply))).toContain(
      `https://app.example.com/transactions?q=${encodeURIComponent("กาแฟ")}`,
    );
  });
});
