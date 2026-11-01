import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseMessage } from "@/lib/parse/text-parser";
import { ROUTER_DAILY_LIMIT } from "@/lib/plan";
import type { IntentRouter } from "./intent-router";
import { clockIsTheAmount, needsRouter, runRouter } from "./route-text";

const take = vi.fn(async () => true);
const refund = vi.fn(async () => undefined);
vi.mock("@/lib/usage", async (original) => ({
  ...(await original<typeof import("@/lib/usage")>()),
  takeUsage: (...a: unknown[]) => take(...(a as [])),
  refundUsage: (...a: unknown[]) => refund(...(a as [])),
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
  ])("sends %s to the router", (t) => expect(needsRouter(t, read(t))).toBe(true));

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

describe("clockIsTheAmount", () => {
  it.each([
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
    take.mockResolvedValue(true);
    route.mockResolvedValue({ intent: "ask", confidence: 0.9 });
  });

  it("takes one use on the Bangkok day", async () => {
    await expect(runRouter(deps, input)).resolves.toMatchObject({ intent: "ask" });
    expect(take).toHaveBeenCalledWith(db, "u1", "router", ROUTER_DAILY_LIMIT.free, "2026-11-01");
  });

  it("counts the day in Bangkok, not in UTC", async () => {
    const late = { router, now: () => new Date("2026-11-01T18:00:00Z") };
    await runRouter(late, input);
    expect(take).toHaveBeenCalledWith(db, "u1", "router", 10, "2026-11-02");
  });

  it("returns null without calling the AI when the day is used up", async () => {
    take.mockResolvedValue(false);
    await expect(runRouter(deps, input)).resolves.toBeNull();
    expect(route).not.toHaveBeenCalled();
  });

  it("gives the use back when the AI fails", async () => {
    route.mockRejectedValue(new Error("down"));
    await expect(runRouter(deps, input)).resolves.toBeNull();
    expect(refund).toHaveBeenCalledWith(db, "u1", "router", "2026-11-01");
  });

  it("gives the use back when the reply is junk", async () => {
    route.mockResolvedValue({ intent: "nope" });
    await expect(runRouter(deps, input)).resolves.toBeNull();
    expect(refund).toHaveBeenCalledOnce();
  });

  it("returns null when the usage counter is down", async () => {
    take.mockRejectedValue(new Error("db"));
    await expect(runRouter(deps, input)).resolves.toBeNull();
    expect(route).not.toHaveBeenCalled();
  });

  it("skips the AI for text over 1000 characters", async () => {
    const d = await runRouter(deps, { ...input, text: "ก".repeat(1001) });
    expect(d).toMatchObject({ intent: "unclear", confidence: 0 });
    expect(take).not.toHaveBeenCalled();
    expect(route).not.toHaveBeenCalled();
  });

  it("never sends secret text", async () => {
    await expect(runRouter(deps, { ...input, text: "รหัสไวไฟ 1234" })).resolves.toBeNull();
    expect(route).not.toHaveBeenCalled();
  });

  it("is null when there is no router", async () => {
    await expect(runRouter({ now: () => NOW }, input)).resolves.toBeNull();
  });
});
