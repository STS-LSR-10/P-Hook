import { describe, expect, it, vi } from "vitest";
import { parseMessage } from "@/lib/parse/text-parser";
import { needsSmartParse, runSmartParse } from "./smart-parse";
import type { TextStructurer } from "./text-structurer";

const NOW = new Date("2026-10-17T08:00:00Z");
const needs = (text: string) => needsSmartParse(text, parseMessage(text, NOW));

describe("needsSmartParse", () => {
  it.each(["กาแฟ 30", "ข้าวมันไก่ 50", "เงินเดือน 25000", "เมื่อวาน กาแฟ 60", "12/10 ค่าไฟ 1200"])(
    "short clear message stays with the rules: %s",
    (t) => expect(needs(t)).toBe(false),
  );

  it("a list of short lines stays with the rules even when the whole text is long", () => {
    expect(needs("ข้าวเช้า 50\nกาแฟ 45\nวินมอไซค์ 30\nข้าวเที่ยง 60\nน้ำ 15")).toBe(false);
  });

  it("a long sentence goes to the AI", () => {
    expect(needs("ไปกินข้าวกับแฟนมา จ่ายไป 850 บาท เอาออกจากกระเป๋าเงินสดนะ")).toBe(true);
  });

  it("a message the rules could not read goes to the AI", () => {
    expect(needs("วันนี้ซื้อของมาหลายอย่างเลย")).toBe(true);
  });

  it("a part without an amount goes to the AI", () => {
    expect(needs("กาแฟ 30, พรุ่งนี้ไปเที่ยว")).toBe(true);
  });

  it("an unsure reading (no title) goes to the AI", () => {
    expect(needs("500")).toBe(true);
  });
});

const sentence = "จ่ายค่าข้าวไป 850 บาท";
const good = { entries: [{ type: "expense", title: "ค่าข้าว", amount: 850 }] };
const mk = (structure: TextStructurer["structure"]): TextStructurer => ({ name: "t", structure });
const input = { text: sentence, subject: "U1", categories: [] };

describe("runSmartParse and the ask-AI quota", () => {
  const counters = new Map<string, number>();
  const limits: number[] = [];
  const cap = (limitLeft: boolean) => ({
    db: {
      rpc: async (fn: string, args: Record<string, unknown>) => {
        const key = `${args.p_kind}|${args.p_month}`;
        const amount = Number(args.p_amount);
        if (fn === "take_usage_amount") {
          limits.push(Number(args.p_limit));
          if (!limitLeft) return { data: false, error: null };
          counters.set(key, (counters.get(key) ?? 0) + amount);
          return { data: true, error: null };
        }
        counters.set(key, Math.max(0, (counters.get(key) ?? 0) - amount));
        return { data: null, error: null };
      },
    } as never,
    userId: "u1",
    plan: "ultimate" as const,
  });

  it("counts a successful read against ask-AI, up to the plan's limit", async () => {
    counters.clear();
    limits.length = 0;
    const out = await runSmartParse(
      { structurer: mk(async () => good), now: () => NOW },
      { ...input, cap: cap(true) },
    );
    expect(out).not.toBeNull();
    expect(counters.get("ai_chat|2026-10-01")).toBe(1);
    expect(counters.has("smart_parse|2026-10-01")).toBe(false);
    expect(limits).toEqual([2300]);
  });

  it("past the quota the AI is not called and the rules read instead", async () => {
    const structure = vi.fn(async () => good);
    const out = await runSmartParse(
      { structurer: mk(structure), now: () => NOW },
      { ...input, cap: cap(false) },
    );
    expect(out).toBeNull();
    expect(structure).not.toHaveBeenCalled();
  });

  it("a read that fails or finds nothing gives its use back", async () => {
    counters.clear();
    const boom = mk(async () => {
      throw new Error("down");
    });
    await runSmartParse({ structurer: boom, now: () => NOW }, { ...input, cap: cap(true) });
    expect(counters.get("ai_chat|2026-10-01")).toBe(0);
    const empty = mk(async () => ({ entries: [] }));
    await runSmartParse({ structurer: empty, now: () => NOW }, { ...input, cap: cap(true) });
    expect(counters.get("ai_chat|2026-10-01")).toBe(0);
  });
});

describe("runSmartParse", () => {
  it("returns the validated entries", async () => {
    const out = await runSmartParse({ structurer: mk(async () => good), now: () => NOW }, input);
    expect(out?.[0]).toMatchObject({ title: "ค่าข้าว", amountSatang: 85_000 });
  });

  it("is null without a structurer", async () => {
    expect(await runSmartParse({ now: () => NOW }, input)).toBeNull();
  });

  it("is null (and the AI is not called) when the daily ceiling is reached", async () => {
    const structure = vi.fn(async () => good);
    const out = await runSmartParse(
      {
        structurer: mk(structure),
        limit: async () => ({ allowed: false, hits: 61, limit: 60 }),
        now: () => NOW,
      },
      input,
    );
    expect(out).toBeNull();
    expect(structure).not.toHaveBeenCalled();
  });

  it("is null when the AI fails or has nothing usable (never throws)", async () => {
    const boom = mk(async () => {
      throw new Error("down");
    });
    expect(await runSmartParse({ structurer: boom, now: () => NOW }, input)).toBeNull();
    const empty = mk(async () => ({ entries: [] }));
    expect(await runSmartParse({ structurer: empty, now: () => NOW }, input)).toBeNull();
  });

  it("tells the AI today's date in Bangkok", async () => {
    const structure = vi.fn<(r: unknown) => Promise<unknown>>(async () => good);
    await runSmartParse(
      { structurer: mk(structure as TextStructurer["structure"]), now: () => NOW },
      input,
    );
    expect((structure.mock.calls[0]?.[0] as { today: string }).today).toBe("2026-10-17");
  });
});
