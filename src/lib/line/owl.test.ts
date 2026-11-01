import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Owl } from "@/lib/ai/owl";
import type { UserRow } from "@/lib/repo";
import {
  OWL_DAY_LIMIT_TEXT,
  OWL_END_TEXT,
  OWL_FAILED_TEXT,
  OWL_NOT_IN_MODE_TEXT,
  OWL_SECRET_TEXT,
  OWL_UNAVAILABLE_TEXT,
  owlQuotaText,
} from "./messages";
import { inOwlMode, keepOwlOpen, owlAsk, owlEnd, owlStart, type OwlDeps } from "./owl";

let plan = "plus";
let usageLeft = 50;
let live = false;
const waits: string[] = [];
const refunds: string[] = [];

vi.mock("@/lib/usage", async (original) => ({
  ...(await original<typeof import("@/lib/usage")>()),
  takeUsage: async () => usageLeft-- > 0,
  refundUsage: async (_d: unknown, _u: unknown, kind: string) => {
    refunds.push(kind);
  },
}));
vi.mock("@/lib/ask-repo", () => ({
  startAskWait: async () => {
    waits.push("start");
  },
  clearAskWait: async () => {
    waits.push("clear");
  },
  isAskWaitLive: async () => live,
}));
const loaded: string[] = [];
vi.mock("@/lib/owl-context", () => ({
  loadOwlFacts: async (_d: unknown, _u: string, q: string) => {
    loaded.push(q);
    return {};
  },
  renderOwlContext: () => "DATA",
}));
vi.mock("./upsell-reply", () => ({
  upsellReply: async (_d: unknown, _u: unknown, _n: unknown, feature: string) => [
    { type: "text", text: `upsell:${feature}` },
  ],
}));

const answer = vi.fn<(input: { question: string; data: string }) => Promise<string>>(
  async () => "**ใช้ไป** ฿1,000",
);
const owl: Owl = { name: "t", answer };
const deps = (over: Partial<OwlDeps> = {}): OwlDeps => ({
  db: {} as SupabaseClient,
  now: () => new Date("2026-10-30T05:00:00Z"),
  owl,
  ...over,
});
const user = () =>
  ({ id: "u1", line_user_id: "U1", plan, plan_expires_at: null }) as unknown as UserRow;
type Sent = {
  text?: string;
  quickReply?: { items: { action: { type: string; text?: string; data?: string } }[] };
};
const first = (r: unknown[]) => r[0] as Sent;

beforeEach(() => {
  plan = "plus";
  usageLeft = 50;
  live = false;
  waits.length = 0;
  loaded.length = 0;
  refunds.length = 0;
  answer.mockClear();
  answer.mockImplementation(async () => "**ใช้ไป** ฿1,000");
});

describe("starting and ending", () => {
  it("opens the mode and offers example questions and a way out", async () => {
    const out = first(await owlStart(deps(), user()));
    expect(waits).toEqual(["start"]);
    expect(out.text).toContain("พี่ฮูกมาแล้ว");
    const items = out.quickReply?.items ?? [];
    expect(items.filter((i) => i.action.type === "message").map((i) => i.action.text)).toContain(
      "วิเคราะห์เดือนนี้",
    );
    expect(items.at(-1)?.action.data).toBe("a=owlx");
  });

  it("says it is not available without an AI key, and opens nothing", async () => {
    expect(first(await owlStart(deps({ owl: undefined }), user())).text).toBe(OWL_UNAVAILABLE_TEXT);
    expect(waits).toHaveLength(0);
    expect(await inOwlMode(deps({ owl: undefined }), user())).toBe(false);
  });

  it("ending closes the mode and says so; outside the mode it says there is none", async () => {
    live = true;
    expect(first(await owlEnd(deps(), user())).text).toBe(OWL_END_TEXT);
    live = false;
    expect(first(await owlEnd(deps(), user())).text).toBe(OWL_NOT_IN_MODE_TEXT);
    expect(waits).toEqual(["clear", "clear"]);
  });
});

describe("after an action in the mode", () => {
  const button = (data: string) => ({ type: "action", action: { type: "postback", data } });
  const dataOf = (r: unknown[]) =>
    (r.at(-1) as Sent).quickReply?.items.map((i) => i.action.data) ?? [];

  it("adds the way out under the last message, and gives more time", async () => {
    const r = await keepOwlOpen(deps(), user(), [
      { type: "text", text: "1" },
      { type: "text", text: "2" },
    ]);
    expect(dataOf(r)).toEqual(["a=owlx"]);
    expect(first(r).quickReply).toBeUndefined();
    expect(waits).toEqual(["start"]);
  });

  it("keeps the buttons a card already has", async () => {
    const r = await keepOwlOpen(deps(), user(), [
      { type: "flex", quickReply: { items: [button("a=x")] } },
    ]);
    expect(dataOf(r)).toEqual(["a=x", "a=owlx"]);
  });

  it("never adds it twice", async () => {
    const answered = await owlAsk(deps(), user(), "เดือนนี้ใช้ไปเท่าไร", true, "U1");
    const r = await keepOwlOpen(deps(), user(), answered);
    expect(dataOf(r).filter((d) => d === "a=owlx")).toHaveLength(1);
  });

  it("leaves a card that has no room for another button, but still gives more time", async () => {
    const items = Array.from({ length: 13 }, (_, i) => button(`a=${i}`));
    const r = await keepOwlOpen(deps(), user(), [{ type: "flex", quickReply: { items } }]);
    expect(dataOf(r)).toHaveLength(13);
    expect(waits).toEqual(["start"]);
  });

  it("gives more time when nothing is sent back", async () => {
    expect(await keepOwlOpen(deps(), user(), [])).toEqual([]);
    expect(waits).toEqual(["start"]);
  });
});

describe("what looks like a password", () => {
  it("never reaches the AI, and costs nothing", async () => {
    usageLeft = 0;
    const r = await owlAsk(deps(), user(), "รหัสเอทีเอ็ม 1234", false, "U1");
    expect(answer).not.toHaveBeenCalled();
    expect(first(r).text).toBe(OWL_SECRET_TEXT);
  });
});

describe("asking", () => {
  it("answers in plain text, using one question of the quota, and sends the data with it", async () => {
    const out = first(await owlAsk(deps(), user(), "เดือนนี้ใช้ไปเท่าไร", false, "U1"));
    expect(out.text).toBe("ใช้ไป ฿1,000");
    expect(out.quickReply).toBeUndefined(); // a one-off question has no buttons
    expect(answer).toHaveBeenCalledWith({ question: "เดือนนี้ใช้ไปเท่าไร", data: "DATA" });
    expect(usageLeft).toBe(49);
    expect(waits).toHaveLength(0);
  });

  it("in the mode, keeps it open for a few more minutes and shows the way out", async () => {
    const out = first(await owlAsk(deps(), user(), "หมวดไหนเยอะสุด", true, "U1"));
    expect(waits).toEqual(["start"]);
    expect(out.quickReply?.items.map((i) => i.action.data)).toEqual(["a=owlx"]);
  });

  it("a general question gets no data from the person's records, and still costs one question", async () => {
    const out = first(await owlAsk(deps(), user(), "ทำไมท้องฟ้าสีฟ้า", false, "U1"));
    expect(loaded).toEqual([]);
    expect(answer).toHaveBeenCalledWith({ question: "ทำไมท้องฟ้าสีฟ้า", data: "" });
    expect(out.text).toBe("ใช้ไป ฿1,000");
    expect(refunds).toHaveLength(0);
    expect(usageLeft).toBe(49);
  });

  it("a question about their money loads their records and sends them along", async () => {
    await owlAsk(deps(), user(), "วิเคราะห์การใช้จ่ายเดือนนี้", false, "U1");
    expect(loaded).toEqual(["วิเคราะห์การใช้จ่ายเดือนนี้"]);
    expect(answer).toHaveBeenCalledWith({ question: "วิเคราะห์การใช้จ่ายเดือนนี้", data: "DATA" });
  });

  it("an empty question starts the mode instead", async () => {
    expect(first(await owlAsk(deps(), user(), "   ", false, "U1")).text).toContain("พี่ฮูกมาแล้ว");
  });

  it("a question over 300 characters is not sent", async () => {
    const out = first(await owlAsk(deps(), user(), "ก".repeat(301), false, "U1"));
    expect(out.text).toContain("ไม่เกิน 300");
    expect(answer).not.toHaveBeenCalled();
    expect(usageLeft).toBe(50);
  });

  it("gives the quota back when the AI fails or says nothing", async () => {
    answer.mockRejectedValueOnce(new Error("boom"));
    expect(first(await owlAsk(deps(), user(), "x", false, "U1")).text).toBe(OWL_FAILED_TEXT);
    answer.mockResolvedValueOnce("   ");
    expect(first(await owlAsk(deps(), user(), "x", false, "U1")).text).toBe(OWL_FAILED_TEXT);
    expect(refunds).toEqual(["owl", "owl"]);
  });

  it("stops at the monthly quota: Free is pitched an upgrade, Pro and Elite get the plain text", async () => {
    usageLeft = 0;
    plan = "free";
    expect(first(await owlAsk(deps(), user(), "x", false, "U1")).text).toBe("upsell:owl");
    plan = "plus";
    usageLeft = 0;
    expect(first(await owlAsk(deps(), user(), "x", false, "U1")).text).toBe(
      owlQuotaText("plus", 50),
    );
    plan = "ultimate";
    usageLeft = 0;
    expect(first(await owlAsk(deps(), user(), "x", false, "U1")).text).toBe(
      owlQuotaText("ultimate", 300),
    );
    expect(answer).not.toHaveBeenCalled();
  });

  it("stops at the daily cap before using any quota", async () => {
    const limit = vi.fn(async () => ({ allowed: false, hits: 41, limit: 40 }));
    const out = first(await owlAsk(deps({ limit }), user(), "x", false, "U1"));
    expect(out.text).toBe(OWL_DAY_LIMIT_TEXT);
    expect(usageLeft).toBe(50);
  });
});
