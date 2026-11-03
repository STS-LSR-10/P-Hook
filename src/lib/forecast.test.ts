import { describe, expect, it } from "vitest";
import {
  forecastCycle,
  upcomingOccurrences,
  type ForecastInput,
  type Occurrence,
  type RuleLite,
} from "./forecast";
import { fromBangkok } from "./thai-date";

const baht = (n: number) => n * 100;
const day = (m: number, d: number) => fromBangkok(2026, m, d);
const cycle = { from: day(10, 1), to: day(11, 1) }; // 1 Oct .. 31 Oct (31 days)
const at = (d: number) => new Date(day(10, d).getTime() + 8 * 3600_000); // 08:00 Bangkok

function input(over: Partial<ForecastInput> = {}): ForecastInput {
  return {
    now: at(11),
    cycle,
    incomeSatang: baht(30_000),
    expenseSatang: baht(11_000),
    recurringExpenseSatang: 0,
    entryCount: 20,
    last7VariableSatang: null,
    upcoming: [],
    budgetSatang: null,
    ...over,
  };
}
const occ = (d: number, type: "income" | "expense", amount: number, title = "x"): Occurrence => ({
  date: day(10, d),
  type,
  amountSatang: baht(amount),
  title,
});

describe("forecastCycle: the days", () => {
  it("counts the days so far (today included) and the days left", () => {
    const f = forecastCycle(input());
    expect(f.totalDays).toBe(31);
    expect(f.elapsedDays).toBe(11);
    expect(f.remainingDays).toBe(20);
  });

  it("first day of the cycle: one day in, few entries -> low data", () => {
    const f = forecastCycle(input({ now: at(1), expenseSatang: baht(100), entryCount: 2 }));
    expect(f.elapsedDays).toBe(1);
    expect(f.remainingDays).toBe(30);
    expect(f.lowData).toBe(true);
  });

  it("last day of the cycle: nothing left to project, the end is today's balance", () => {
    const f = forecastCycle(input({ now: at(31) }));
    expect(f.remainingDays).toBe(0);
    expect(f.endBalanceSatang).toBe(f.netNowSatang);
    expect(f.runsOutOn).toBeNull();
  });

  it("enough days and entries is not low data", () => {
    expect(forecastCycle(input()).lowData).toBe(false);
    expect(forecastCycle(input({ entryCount: 4 })).lowData).toBe(true);
  });
});

describe("forecastCycle: the pace", () => {
  it("projects the rest of the cycle at the pace so far", () => {
    const f = forecastCycle(input()); // 11,000 over 11 days = 1,000 a day
    expect(f.dailyRateSatang).toBe(baht(1000));
    expect(f.netNowSatang).toBe(baht(19_000));
    expect(f.endBalanceSatang).toBe(baht(19_000 - 20 * 1000)); // -1,000
  });

  it("says on which day the money runs out", () => {
    const f = forecastCycle(input());
    // 19,000 covers 19 days after today (11 Oct); the 20th day, 31 Oct, goes below zero
    expect(f.runsOutOn?.getTime()).toBe(day(10, 31).getTime());
  });

  it("no run-out when the money lasts to the end of the cycle", () => {
    const f = forecastCycle(input({ incomeSatang: baht(40_000) }));
    expect(f.endBalanceSatang).toBe(baht(40_000 - 11_000 - 20_000));
    expect(f.runsOutOn).toBeNull();
  });

  it("already below zero: says so and gives no run-out date", () => {
    const f = forecastCycle(input({ incomeSatang: baht(5000) }));
    expect(f.alreadyNegative).toBe(true);
    expect(f.runsOutOn).toBeNull();
    expect(f.endBalanceSatang).toBeLessThan(f.netNowSatang);
  });

  it("no spending at all: nothing is projected", () => {
    const f = forecastCycle(input({ expenseSatang: 0, entryCount: 6 }));
    expect(f.dailyRateSatang).toBe(0);
    expect(f.endBalanceSatang).toBe(f.netNowSatang);
    expect(f.runsOutOn).toBeNull();
  });

  it("rounds the daily rate to whole satang", () => {
    const f = forecastCycle(input({ expenseSatang: 1000, incomeSatang: 5000 })); // 1000/11
    expect(Number.isInteger(f.dailyRateSatang)).toBe(true);
    expect(f.dailyRateSatang).toBe(91);
  });
});

describe("forecastCycle: recurring rules", () => {
  it("the rent a rule already booked is not averaged into the daily pace", () => {
    const f = forecastCycle(
      input({ expenseSatang: baht(16_000), recurringExpenseSatang: baht(5000) }),
    );
    expect(f.variableSpentSatang).toBe(baht(11_000));
    expect(f.dailyRateSatang).toBe(baht(1000));
  });

  it("known salary and bills are placed on their own days", () => {
    const f = forecastCycle(
      input({
        incomeSatang: baht(5000),
        expenseSatang: baht(1100),
        upcoming: [occ(25, "income", 30_000, "เงินเดือน"), occ(28, "expense", 5000, "ผ่อน")],
      }),
    );
    expect(f.upcomingIncomeSatang).toBe(baht(30_000));
    expect(f.upcomingExpenseSatang).toBe(baht(5000));
    // 3,900 now, rate 100/day: runs dry on day 11+39? no - lasts until the salary arrives
    expect(f.runsOutOn).toBeNull();
    expect(f.endBalanceSatang).toBe(baht(3900 + 30_000 - 5000 - 20 * 100));
  });

  it("without the salary the same person runs out before the end", () => {
    const f = forecastCycle(input({ incomeSatang: baht(1500), expenseSatang: baht(1100) }));
    expect(f.runsOutOn).not.toBeNull();
  });

  it("a bill dated today is in the balance today, and may be what tips it below zero", () => {
    const f = forecastCycle(
      input({
        incomeSatang: baht(1200),
        expenseSatang: baht(1100),
        upcoming: [occ(11, "expense", 500)],
      }),
    );
    expect(f.runsOutOn?.getTime()).toBe(day(10, 11).getTime());
  });
});

describe("forecastCycle: the last seven days", () => {
  it("shows a second scenario only from ten days in", () => {
    expect(forecastCycle(input({ now: at(9), last7VariableSatang: baht(7000) })).trend).toBeNull();
    expect(forecastCycle(input({ last7VariableSatang: null })).trend).toBeNull();
    const t = forecastCycle(input({ last7VariableSatang: baht(3500) })).trend;
    expect(t?.dailyRateSatang).toBe(baht(500));
    expect(t?.endBalanceSatang).toBe(baht(19_000 - 20 * 500));
    expect(t?.runsOutOn).toBeNull();
  });
});

describe("forecastCycle: the overall budget", () => {
  it("projects the spending against the budget", () => {
    const f = forecastCycle(input({ budgetSatang: baht(20_000) }));
    // 11,000 so far + 20 days x 1,000
    expect(f.budget?.projectedSpendSatang).toBe(baht(31_000));
    expect(f.budget?.percent).toBe(155);
    expect(f.budget?.overNow).toBe(false);
    // 9,000 left of the budget covers 9 days after today: 20 Oct is the day it is reached
    expect(f.budget?.exhaustedOn?.getTime()).toBe(day(10, 20).getTime());
  });

  it("already over budget: flagged, with no future date", () => {
    const f = forecastCycle(input({ budgetSatang: baht(10_000) }));
    expect(f.budget?.overNow).toBe(true);
    expect(f.budget?.exhaustedOn).toBeNull();
  });

  it("a budget that holds has no exhaust date", () => {
    const f = forecastCycle(input({ budgetSatang: baht(100_000) }));
    expect(f.budget?.exhaustedOn).toBeNull();
    expect(f.budget?.percent).toBe(31);
  });

  it("no budget set, none shown", () => {
    expect(forecastCycle(input()).budget).toBeNull();
    expect(forecastCycle(input({ budgetSatang: 0 })).budget).toBeNull();
  });
});

describe("upcomingOccurrences", () => {
  const rule = (over: Partial<RuleLite>): RuleLite => ({
    type: "expense",
    amountSatang: baht(100),
    title: "r",
    cadence: "monthly",
    dayOfPeriod: 28,
    nextRunAt: day(10, 28),
    isActive: true,
    ...over,
  });
  const dates = (xs: Occurrence[]) => xs.map((o) => o.date.getTime());

  it("a monthly rule gives one run in the cycle", () => {
    expect(dates(upcomingOccurrences([rule({})], at(11), cycle.to))).toEqual([
      day(10, 28).getTime(),
    ]);
  });

  it("a weekly rule gives every week until the end", () => {
    const r = rule({ cadence: "weekly", dayOfPeriod: 1, nextRunAt: day(10, 12) }); // Mondays
    expect(dates(upcomingOccurrences([r], at(11), cycle.to))).toEqual(
      [12, 19, 26].map((d) => day(10, d).getTime()),
    );
  });

  it("a daily rule gives a run for each remaining day", () => {
    const r = rule({ cadence: "daily", dayOfPeriod: null, nextRunAt: day(10, 12) });
    expect(upcomingOccurrences([r], at(11), cycle.to)).toHaveLength(20);
  });

  it("a switched-off rule gives nothing, and a run after the cycle is left out", () => {
    expect(upcomingOccurrences([rule({ isActive: false })], at(11), cycle.to)).toEqual([]);
    expect(upcomingOccurrences([rule({ nextRunAt: day(11, 3) })], at(11), cycle.to)).toEqual([]);
  });

  it("a run that is already due counts as today", () => {
    const r = rule({ cadence: "monthly", dayOfPeriod: 5, nextRunAt: day(10, 5) });
    const out = upcomingOccurrences([r], at(11), cycle.to);
    expect(out[0]?.date.getTime()).toBe(day(10, 11).getTime());
  });

  it("is sorted by date and carries type, amount and title", () => {
    const out = upcomingOccurrences(
      [
        rule({ title: "ผ่อน", nextRunAt: day(10, 28) }),
        rule({
          type: "income",
          title: "เงินเดือน",
          nextRunAt: day(10, 25),
          amountSatang: baht(30_000),
        }),
      ],
      at(11),
      cycle.to,
    );
    expect(out.map((o) => o.title)).toEqual(["เงินเดือน", "ผ่อน"]);
    expect(out[0]).toMatchObject({ type: "income", amountSatang: baht(30_000) });
  });
});

describe("forecastCycle in a zone whose clocks change", () => {
  it("counts a bill after the change on its own day (New York, clocks back on 1 Nov)", async () => {
    const { runInZone } = await import("@/lib/zone-scope");
    runInZone("America/New_York", () => {
      const ny = (m: number, d: number) => fromBangkok(2026, m, d);
      const f = forecastCycle({
        now: new Date(ny(10, 20).getTime() + 8 * 3600_000),
        cycle: { from: ny(10, 15), to: ny(11, 15) },
        incomeSatang: baht(1000),
        expenseSatang: 0,
        recurringExpenseSatang: 0,
        entryCount: 20,
        last7VariableSatang: null,
        upcoming: [{ date: ny(11, 5), type: "expense", amountSatang: baht(5000), title: "rent" }],
        budgetSatang: baht(3000),
      });
      // the rent (after the change) is counted, so the money runs out on its day
      expect(f.runsOutOn?.toISOString()).toBe(ny(11, 5).toISOString());
      expect(f.budget?.exhaustedOn?.toISOString()).toBe(ny(11, 5).toISOString());
    });
  });
});
