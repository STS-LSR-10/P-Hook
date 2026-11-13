import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseMessage } from "@/lib/parse/text-parser";
import { AI_CHAT_LIMIT } from "@/lib/plan";
import type { IntentRouter } from "./intent-router";
import {
  BREAKER_FAILURES,
  BREAKER_PAUSE_MS,
  BREAKER_WINDOW_MS,
  clockIsTheAmount,
  needsRouter,
  resetRouterBreaker,
  runRouter,
} from "./route-text";

const take = vi.fn(async () => true);
const refund = vi.fn(async () => undefined);
const takeAmount = vi.fn(async () => true);
const refundAmount = vi.fn(async () => undefined);
vi.mock("@/lib/usage", async (original) => ({
  ...(await original<typeof import("@/lib/usage")>()),
  takeUsage: (...a: unknown[]) => take(...(a as [])),
  refundUsage: (...a: unknown[]) => refund(...(a as [])),
  takeUsageAmount: (...a: unknown[]) => takeAmount(...(a as [])),
  refundUsageAmount: (...a: unknown[]) => refundAmount(...(a as [])),
}));

const hintsOf = vi.fn(async () => [] as string[]);
vi.mock("@/lib/style-repo", () => ({
  loadStyleHints: (...a: unknown[]) => hintsOf(...(a as [])),
}));

const NOW = new Date("2026-11-01T05:00:00Z");
const db = {} as SupabaseClient;
const read = (t: string) => parseMessage(t, NOW, { currencies: true });

describe("needsRouter", () => {
  it.each(["กินข้าว50", "น้ำมัน 500", "กาแฟ 50"])("keeps %s with the rules", (t) => {
    expect(needsRouter(t, read(t))).toBe(false);
  });

  it.each([
    "กินยา 6 โมงเย็น",
    "ประชุมพรุ่งนี้ 2 ทุ่ม",
    "เตือนวันที่ 15 ต่อทะเบียนรถ",
    "จดว่าไซส์รองเท้า 42",
    "ไปเที่ยวต้องซื้อครีม 2 หลอด",
    "รหัสไวไฟ 12345678",
    "จดไว้ว่าหอพักอยู่ซอย 5",
    "ซื้อนม\nซื้อไข่\nซื้อขนมปัง",
  ])("sends %s to the router", (t) => {
    expect(needsRouter(t, read(t))).toBe(true);
  });

  it.each(["ค่าถ่ายเอกสาร 20", "ซื้อของเก็บไว้ 300", "ค่าส่งไฟล์ 30", "ค่าที่อยู่ 500"])(
    "does not spend a use on the entry %s",
    (t) => expect(needsRouter(t, read(t))).toBe(false),
  );

  it.each([
    "กินยา 18:00",
    "กินยาบ่าย 3",
    "ปลุกตี 5",
    "กินยาอีก 30 นาที",
    "ที่อยู่หอซอย 5",
    "เล่นเกมตอน 19.13 น.",
    "วันศุกร์ที่ 27 งานเลี้ยงบริษัท",
    "วันอาทิตย์ 27 ไปกินข้าวกับเพื่อน",
  ])("sends %s to the router", (t) => expect(needsRouter(t, read(t))).toBe(true));

  it.each([
    "เดือนนี้ใช้ไปเกิน 5000 หรือยัง",
    "ค่าไฟ 2000 แพงไหม",
    "เดือนนี้ค่ากาแฟรวมเท่าไหร่ 50 ไหม",
    "อาทิตย์นี้จ่ายไป 3000 แล้วใช่ไหม?",
    "ถ้าเก็บเดือนละ 3000 กี่เดือนจะถึงแสน",
    "ออมวันละ 100 กี่วันจะครบหมื่น",
    "เงินเดือน 20000 ควรแบ่งยังไง",
  ])("a question with a number in it is not an entry: %s goes to the router", (t) =>
    expect(needsRouter(t, read(t))).toBe(true),
  );

  it.each([
    "กาแฟ 50",
    "ค่าทำไม้ระแนง 500",
    "ยังไงก็จ่ายค่าเช่า 5000",
    "ค่าเช่า 3 เดือน 15000",
    "เตือนใจ 200",
    "ค่าซ่อมรถ 1200",
    "จ่ายค่าเทอม 12000",
  ])("an ordinary entry stays with the rules: %s", (t) =>
    expect(needsRouter(t, read(t))).toBe(false),
  );

  it.each(["ผ้าไหม 500", "ไหมพรม 120", "1200 ผ้าไหม", "ค่าผ้า 500 ผ้าไหม"])(
    "an entry about silk stays one: %s",
    (t) => expect(needsRouter(t, read(t))).toBe(false),
  );

  it("keeps a typed list of entries with the rules", () => {
    const t = "กาแฟ 50\nข้าว 60\nน้ำ 20";
    expect(needsRouter(t, read(t))).toBe(false);
  });
});

describe("an amount with satang", () => {
  it("stays with the rules", () => {
    expect(needsRouter("กาแฟ 45.50", read("กาแฟ 45.50"))).toBe(false);
  });
});

describe("a weekday in an entry", () => {
  it.each([
    "ข้าววันศุกร์ 60",
    "ค่าข้าววันอาทิตย์ 120",
    "ตลาดนัดวันพุธ 300",
    "วันจันทร์ 50 กาแฟ",
    "ข้าววันศุกร์ 25",
    "ตลาดนัดวันพุธ 20",
  ])("%s stays with the rules", (t) => expect(needsRouter(t, read(t))).toBe(false));
});

describe("clockIsTheAmount", () => {
  it.each(["วันจันทร์ 30 กาแฟ", "ข้าววันศุกร์ 25"])(
    "a small price after a weekday is still money in %s",
    (t) => expect(clockIsTheAmount(t, read(t).entries)).toBe(false),
  );

  it.each([
    "วันอาทิตย์ 27 ไปกินข้าวกับเพื่อน",
    "วันศุกร์ที่ 27 งานเลี้ยงบริษัท",
    "กินยา 6 โมงเย็น",
    "กินยา 18:00",
    "กินยาบ่าย 3",
    "ปลุกตี 5",
    "กินยาอีก 30 นาที",
    "กินยา ๖ โมงเย็น",
    "เล่นเกมตอน 19.13 น.",
  ])("sees the time was read as money in %s", (t) =>
    expect(clockIsTheAmount(t, read(t).entries)).toBe(true),
  );

  it.each([
    "เมื่อเช้า 8 โมง กาแฟ 60",
    "เมื่อวาน 6 โมงเย็น กินข้าว 120",
    "ค่าจอดรถ 2 ชั่วโมง 40",
    "ค่าเน็ตทุกเดือน 599",
    "กาแฟ 50 เมื่อเช้า",
  ])("leaves the real amount in %s", (t) => {
    expect(clockIsTheAmount(t, read(t).entries)).toBe(false);
  });
});

describe("runRouter", () => {
  const route = vi.fn();
  const router: IntentRouter = { name: "t", route };
  const deps = { router, now: () => NOW };
  const input = { db, userId: "u1", plan: "free" as const, text: "กินยา 6 โมงเย็น" };

  beforeEach(() => {
    vi.clearAllMocks();
    resetRouterBreaker();
    takeAmount.mockResolvedValue(true);
    route.mockResolvedValue({ intent: "ask", confidence: 0.9 });
  });

  it("takes one use of the month's AI quota for up to 20 words", async () => {
    await expect(runRouter(deps, input)).resolves.toMatchObject({ intent: "ask" });
    expect(takeAmount).toHaveBeenCalledWith(
      db,
      "u1",
      "ai_chat",
      1,
      AI_CHAT_LIMIT.free,
      "2026-11-01",
    );
  });

  it("a long message takes one use for each 20 words", async () => {
    const long = Array.from({ length: 45 }, () => "กาแฟ").join(" ");
    await runRouter(deps, { ...input, text: long });
    expect(takeAmount).toHaveBeenCalledWith(
      db,
      "u1",
      "ai_chat",
      3,
      AI_CHAT_LIMIT.free,
      "2026-11-01",
    );
  });

  it("counts the month in Bangkok, not in UTC", async () => {
    const late = { router, now: () => new Date("2026-11-30T18:00:00Z") };
    await runRouter(late, input);
    expect(takeAmount).toHaveBeenCalledWith(db, "u1", "ai_chat", 1, 200, "2026-12-01");
  });

  it("quota used up: no AI, null (the rules read it), and says the quota is out", async () => {
    takeAmount.mockResolvedValue(false);
    const onQuotaOut = vi.fn();
    await expect(runRouter({ ...deps, onQuotaOut }, input)).resolves.toBeNull();
    expect(route).not.toHaveBeenCalled();
    expect(onQuotaOut).toHaveBeenCalledOnce();
  });

  it("gives the uses back when the AI fails", async () => {
    route.mockRejectedValue(new Error("down"));
    await expect(runRouter(deps, input)).resolves.toBeNull();
    expect(refundAmount).toHaveBeenCalledWith(db, "u1", "ai_chat", 1, "2026-11-01");
  });

  it("gives the uses back when the reply is junk", async () => {
    route.mockResolvedValue({ intent: "nope" });
    await expect(runRouter(deps, input)).resolves.toBeNull();
    expect(refundAmount).toHaveBeenCalledOnce();
  });

  it("returns null when the usage counter is down", async () => {
    takeAmount.mockRejectedValue(new Error("db"));
    await expect(runRouter(deps, input)).resolves.toBeNull();
    expect(route).not.toHaveBeenCalled();
  });

  it("gives the AI what is known of how this person types", async () => {
    hintsOf.mockResolvedValueOnce(["They often type Thai digits."]);
    await runRouter(deps, input);
    expect(route).toHaveBeenCalledWith(
      expect.objectContaining({ hints: ["They often type Thai digits."] }),
    );
  });

  it("skips the AI for text over 1000 characters", async () => {
    const d = await runRouter(deps, { ...input, text: "ก".repeat(1001) });
    expect(d).toMatchObject({ intent: "unclear", confidence: 0 });
    expect(takeAmount).not.toHaveBeenCalled();
    expect(route).not.toHaveBeenCalled();
  });

  it("never sends secret text", async () => {
    await expect(runRouter(deps, { ...input, text: "รหัสไวไฟ 1234" })).resolves.toBeNull();
    expect(route).not.toHaveBeenCalled();
  });

  it("is null when there is no router", async () => {
    await expect(runRouter({ now: () => NOW }, input)).resolves.toBeNull();
  });

  describe("circuit breaker", () => {
    const at = (ms: number) => ({ router, now: () => new Date(NOW.getTime() + ms) });
    const fail = async (ms = 0) => {
      route.mockRejectedValueOnce(Object.assign(new Error("timed out"), { name: "TimeoutError" }));
      await runRouter(at(ms), input);
    };

    it("skips the AI, and charges nothing, after repeated failures in a minute", async () => {
      for (let i = 0; i < BREAKER_FAILURES; i++) await fail(i * 1000);
      vi.clearAllMocks();
      await expect(runRouter(at(5_000), input)).resolves.toBeNull();
      expect(route).not.toHaveBeenCalled();
      expect(takeAmount).not.toHaveBeenCalled();
    });

    it("is not told the quota is out while the AI is paused", async () => {
      const onQuotaOut = vi.fn();
      for (let i = 0; i < BREAKER_FAILURES; i++) await fail(i);
      await runRouter({ ...at(10), onQuotaOut }, input);
      expect(onQuotaOut).not.toHaveBeenCalled();
    });

    it("tries again once the pause is over", async () => {
      for (let i = 0; i < BREAKER_FAILURES; i++) await fail(i);
      vi.clearAllMocks();
      await expect(runRouter(at(BREAKER_PAUSE_MS + 1_000), input)).resolves.toMatchObject({
        intent: "ask",
      });
    });

    it("does not trip on failures spread out over more than the window", async () => {
      for (let i = 0; i < BREAKER_FAILURES; i++) await fail(i * (BREAKER_WINDOW_MS + 1_000));
      vi.clearAllMocks();
      const last = BREAKER_FAILURES * (BREAKER_WINDOW_MS + 1_000);
      await expect(runRouter(at(last), input)).resolves.toMatchObject({ intent: "ask" });
    });

    it("a good answer clears the count", async () => {
      for (let i = 0; i < BREAKER_FAILURES - 1; i++) await fail(i);
      await runRouter(at(100), input);
      await fail(200);
      await fail(300);
      vi.clearAllMocks();
      await expect(runRouter(at(400), input)).resolves.toMatchObject({ intent: "ask" });
    });

    it("a usage-counter outage does not count", async () => {
      takeAmount.mockRejectedValue(new Error("db"));
      for (let i = 0; i < BREAKER_FAILURES; i++) await runRouter(at(i), input);
      takeAmount.mockResolvedValue(true);
      await expect(runRouter(at(50), input)).resolves.toMatchObject({ intent: "ask" });
    });

    it("one person's odd messages cannot pause the AI for everyone", async () => {
      // an unusable reply, a parse error and a refused request (400) are about the message
      for (let i = 0; i < BREAKER_FAILURES; i++) {
        route.mockResolvedValueOnce({ intent: "nope" });
        await runRouter(at(i), input);
        route.mockRejectedValueOnce(new SyntaxError("Unexpected token"));
        await runRouter(at(i), input);
        route.mockRejectedValueOnce(new Error("gemini-text request failed: 400"));
        await runRouter(at(i), input);
      }
      route.mockClear();
      await expect(runRouter(at(100), input)).resolves.toMatchObject({ intent: "ask" });
      expect(route).toHaveBeenCalledOnce();
    });

    it.each([
      new Error("gemini-text request failed: 503"),
      new Error("gemini-text request failed: 429"),
      new Error("anthropic-text request failed: 401"),
      new TypeError("fetch failed"),
    ])("%s counts: the provider is down or refusing us", async (err) => {
      for (let i = 0; i < BREAKER_FAILURES; i++) {
        route.mockRejectedValueOnce(err);
        await runRouter(at(i), input);
      }
      route.mockClear();
      await expect(runRouter(at(100), input)).resolves.toBeNull();
      expect(route).not.toHaveBeenCalled();
    });
  });
});
