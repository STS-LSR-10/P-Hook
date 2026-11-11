import { describe, expect, it } from "vitest";
import { CHEAPEST_PACK, PASS_PACKS } from "./config";
import {
  awardOnce,
  awardShare,
  awardStreak,
  bangkokDateKey,
  currentStreak,
  NotEnoughPointsError,
  redeemForPlus,
} from "./points";

// Fri 2026-10-16 15:00 Bangkok
const NOW = new Date("2026-10-16T08:00:00Z");

describe("bangkokDateKey", () => {
  it("uses the Bangkok calendar day", () => {
    expect(bangkokDateKey(new Date("2026-10-16T08:00:00Z"))).toBe("2026-10-16");
    // 17:30 UTC on the 15th is already the 16th in Bangkok
    expect(bangkokDateKey(new Date("2026-10-15T17:30:00Z"))).toBe("2026-10-16");
    expect(bangkokDateKey(new Date("2026-10-15T16:59:00Z"))).toBe("2026-10-15");
  });
});

describe("currentStreak", () => {
  it("counts consecutive days ending today", () => {
    expect(currentStreak(["2026-10-16", "2026-10-15", "2026-10-14"], NOW)).toBe(3);
  });

  it("stays alive through yesterday", () => {
    expect(currentStreak(["2026-10-15", "2026-10-14"], NOW)).toBe(2);
  });

  it("breaks after a missed day", () => {
    expect(currentStreak(["2026-10-16", "2026-10-14", "2026-10-13"], NOW)).toBe(1);
    expect(currentStreak(["2026-10-14", "2026-10-13"], NOW)).toBe(0);
  });

  it("handles month boundaries and unordered or duplicate input", () => {
    const now = new Date("2026-11-01T05:00:00Z"); // 1 Nov Bangkok
    expect(currentStreak(["2026-10-30", "2026-11-01", "2026-10-31", "2026-10-31"], now)).toBe(3);
  });

  it("is zero without data", () => {
    expect(currentStreak([], NOW)).toBe(0);
  });
});

describe("Pro Pass packs", () => {
  it("are 3 days for 35, 7 for 75 and 15 for 150, and the cheapest sets the bar", () => {
    expect(PASS_PACKS.map((p) => [p.days, p.coins])).toEqual([
      [3, 35],
      [7, 75],
      [15, 150],
    ]);
    expect(CHEAPEST_PACK).toBe(35);
  });

  it("redeemForPlus charges the pack's price and days, not what the caller says", async () => {
    const calls: Record<string, unknown>[] = [];
    const db = {
      rpc: async (_fn: string, args: Record<string, unknown>) => {
        calls.push(args);
        return { data: "2026-11-01T00:00:00Z", error: null };
      },
    };
    await redeemForPlus(db as never, "u1", "pass7");
    expect(calls[0]).toEqual({ p_user: "u1", p_points: 75, p_days: 7 });
  });

  it("an overdraw becomes NotEnoughPointsError", async () => {
    const db = { rpc: async () => ({ data: null, error: { message: "not_enough_points" } }) };
    await expect(redeemForPlus(db as never, "u1", "pass3")).rejects.toBeInstanceOf(
      NotEnoughPointsError,
    );
  });
});

describe("awardStreak, awardOnce and awardShare", () => {
  type Call = { fn: string; args: Record<string, unknown> };
  /** A database that has these days in the ledger and says "new" the first time it sees a (reason, ref). */
  const fakeDb = (days: string[]) => {
    const calls: Call[] = [];
    const seen = new Set<string>();
    const db = {
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              order: () => ({
                limit: async () => ({
                  data: days.map((ref) => ({ ref })),
                  error: null,
                }),
              }),
            }),
          }),
        }),
      }),
      rpc: async (fn: string, args: Record<string, unknown>) => {
        calls.push({ fn, args });
        const key = `${args.p_reason}|${args.p_ref}`;
        const fresh = !seen.has(key);
        seen.add(key);
        return { data: fresh, error: null };
      },
    };
    return { db: db as never, calls };
  };
  const run = (n: number, end = "2026-10-16") =>
    Array.from({ length: n }, (_, i) => {
      const d = new Date(`${end}T12:00:00Z`);
      d.setUTCDate(d.getUTCDate() - i);
      return d.toISOString().slice(0, 10);
    });

  it("pays nothing before a week, 3 on the seventh day, and again every seventh day", async () => {
    for (const [len, bonus] of [
      [6, null],
      [7, 3],
      [8, null],
      [14, 3],
      [21, 3],
    ] as const) {
      const { db } = fakeDb(run(len));
      const r = await awardStreak(db, "u1", NOW);
      expect(r?.bonus ?? null, `${len} days`).toBe(bonus);
    }
  });

  it("pays 15 more when the run reaches 30 days, on top of its weekly day if both fall on it", async () => {
    const { db, calls } = fakeDb(run(30));
    const r = await awardStreak(db, "u1", NOW);
    expect(r).toEqual({ days: 30, bonus: 15 }); // 30 is not a multiple of 7
    expect(calls.map((c) => c.args.p_reason)).toEqual(["streak_month"]);
    const { db: db2 } = fakeDb(run(210));
    expect((await awardStreak(db2, "u1", NOW))?.bonus).toBe(3 + 15); // 210 = 7 x 30
  });

  it("keys the bonus on where the run began and how long it is, so one run never pays a milestone twice", async () => {
    const { db, calls } = fakeDb(run(7));
    await awardStreak(db, "u1", NOW);
    expect(calls[0]?.args).toMatchObject({
      p_user: "u1",
      p_delta: 3,
      p_reason: "streak_week",
      p_ref: "2026-10-10:7",
    });
    // the same call again: the database says it was paid, so nothing is added
    expect(await awardStreak(db, "u1", NOW)).toBeNull();
  });

  it("a missed day starts the count again", async () => {
    // 5 days, a gap, then 10 more: the run today is 5
    const days = [...run(5), ...run(10, "2026-10-09")];
    const { db } = fakeDb(days);
    expect(await awardStreak(db, "u1", NOW)).toBeNull();
  });

  it("awardOnce is keyed on the person and never throws", async () => {
    const { db, calls } = fakeDb([]);
    expect(await awardOnce(db, "u1", "first_slip", 3)).toBe(true);
    expect(await awardOnce(db, "u1", "first_slip", 3)).toBe(false);
    expect(calls[0]?.args).toMatchObject({ p_reason: "first_slip", p_ref: "u1", p_delta: 3 });
    expect(
      await awardOnce(
        { rpc: () => Promise.reject(new Error("down")) } as never,
        "u1",
        "first_budget",
        2,
      ),
    ).toBe(false);
  });

  it("awardShare is keyed on the Bangkok month", async () => {
    const { db, calls } = fakeDb([]);
    expect(await awardShare(db, "u1", NOW)).toBe(true);
    expect(await awardShare(db, "u1", new Date("2026-10-30T08:00:00Z"))).toBe(false); // same month
    expect(await awardShare(db, "u1", new Date("2026-11-02T08:00:00Z"))).toBe(true); // next month
    expect(calls.map((c) => c.args.p_ref)).toEqual(["2026-10", "2026-10", "2026-11"]);
  });
});
