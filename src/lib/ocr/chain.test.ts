import { describe, expect, it, vi } from "vitest";
import { createSlipReaderChain, isUsableReply } from "./chain";
import type { SlipOcrProvider } from "./provider";

const image = { bytes: new Uint8Array([1]), mimeType: "image/jpeg" };
const NOW = () => new Date("2026-10-15T08:00:00Z");
const GOOD = { is_slip: true, amount: 120, paid_at: "2026-10-14T10:00:00+07:00" };

const ok = (name: string, value: unknown): SlipOcrProvider => ({
  name,
  extract: vi.fn(async () => value),
});
const boom = (name: string, message = "down"): SlipOcrProvider => ({
  name,
  extract: vi.fn(async () => {
    throw new Error(message);
  }),
});

describe("isUsableReply", () => {
  it("accepts a readable slip and a clear 'not a slip'", () => {
    expect(isUsableReply(GOOD, NOW())).toBe(true);
    expect(isUsableReply({ is_slip: false }, NOW())).toBe(true);
  });

  it("rejects a slip with no readable amount, and garbage", () => {
    expect(isUsableReply({ is_slip: true, amount: null }, NOW())).toBe(false);
    expect(isUsableReply("hello", NOW())).toBe(false);
    expect(isUsableReply(null, NOW())).toBe(false);
  });
});

describe("createSlipReaderChain", () => {
  it("returns the first usable reply and stops", async () => {
    const a = ok("a", GOOD);
    const b = ok("b", { ...GOOD, amount: 999 });
    const chain = createSlipReaderChain([a, b], { now: NOW });
    expect(await chain.extract(image)).toEqual(GOOD);
    expect(b.extract).not.toHaveBeenCalled();
  });

  it("falls through readers that throw, in order", async () => {
    const calls: string[] = [];
    const chain = createSlipReaderChain(
      [boom("openai", "quota"), boom("gemini", "503"), ok("anthropic", GOOD)],
      { now: NOW, onSkip: (name) => calls.push(name) },
    );
    expect(await chain.extract(image)).toEqual(GOOD);
    expect(calls).toEqual(["openai", "gemini"]);
  });

  it("falls through an unusable reply to the next reader", async () => {
    const chain = createSlipReaderChain([ok("a", { is_slip: true, amount: null }), ok("b", GOOD)], {
      now: NOW,
    });
    expect(await chain.extract(image)).toEqual(GOOD);
  });

  it("a clear 'not a slip' ends the chain (no further paid calls)", async () => {
    const second = ok("b", GOOD);
    const chain = createSlipReaderChain([ok("a", { is_slip: false }), second], { now: NOW });
    expect(await chain.extract(image)).toEqual({ is_slip: false });
    expect(second.extract).not.toHaveBeenCalled();
  });

  it("returns the last unusable answer when nobody can read it", async () => {
    const unusable = { is_slip: true, amount: null };
    const chain = createSlipReaderChain([boom("a"), ok("b", unusable)], { now: NOW });
    expect(await chain.extract(image)).toEqual(unusable);
  });

  it("rethrows the last error when every reader throws", async () => {
    const chain = createSlipReaderChain([boom("a", "first"), boom("b", "last")], { now: NOW });
    await expect(chain.extract(image)).rejects.toThrow("last");
  });

  it("names itself after its readers", () => {
    expect(createSlipReaderChain([ok("openai", GOOD), ok("gemini", GOOD)]).name).toBe(
      "openai > gemini",
    );
  });

  it("needs at least one reader", () => {
    expect(() => createSlipReaderChain([])).toThrow();
  });
});

describe("createSlipReaderChain options", () => {
  it("passes the extract options on to every reader it tries", async () => {
    const a = boom("a");
    const b = ok("b", GOOD);
    const chain = createSlipReaderChain([a, b], { now: NOW });
    await chain.extract(image, { items: true });
    expect(a.extract).toHaveBeenCalledWith(image, { items: true });
    expect(b.extract).toHaveBeenCalledWith(image, { items: true });
  });
});
