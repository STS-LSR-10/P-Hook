import { describe, expect, it } from "vitest";
import { buildCompareRows, describeTotals, sameSpanRanges } from "./period-compare";
import { fromBangkok } from "./thai-date";

const iso = (d: Date) => d.toISOString();
const at = (y: number, m: number, d: number) => fromBangkok(y, m, d);

describe("sameSpanRanges", () => {
  // monthly cycle starting on the 1st: this cycle is 1 Oct .. 1 Nov
  const cycle = { from: at(2026, 10, 1), to: at(2026, 11, 1) };

  it("mid-cycle: the days so far against the same days at the start of the cycle before", () => {
    const s = sameSpanRanges(cycle, new Date("2026-10-17T08:00:00Z")); // 17 Oct Bangkok
    expect(s.days).toBe(17);
    expect(iso(s.current.from)).toBe(iso(at(2026, 10, 1)));
    expect(iso(s.current.to)).toBe(iso(at(2026, 10, 18))); // includes today
    expect(iso(s.previous.from)).toBe(iso(at(2026, 9, 1)));
    expect(iso(s.previous.to)).toBe(iso(at(2026, 9, 18)));
  });

  it("first day of the cycle: one day against one day", () => {
    const s = sameSpanRanges(cycle, new Date("2026-10-01T03:00:00Z"));
    expect(s.days).toBe(1);
    expect(iso(s.previous.to)).toBe(iso(at(2026, 9, 2)));
  });

  it("last day of the cycle: the whole cycle against the whole cycle before", () => {
    const s = sameSpanRanges(cycle, new Date("2026-10-31T10:00:00Z"));
    expect(s.days).toBe(31);
    expect(iso(s.current.to)).toBe(iso(at(2026, 11, 1)));
    // September has 30 days: the earlier side stops at its own end
    expect(iso(s.previous.to)).toBe(iso(at(2026, 10, 1)));
  });

  it("a cycle that starts on the 25th", () => {
    const c = { from: at(2026, 10, 25), to: at(2026, 11, 25) };
    const s = sameSpanRanges(c, new Date("2026-10-27T08:00:00Z")); // 27 Oct
    expect(s.days).toBe(3);
    expect(iso(s.previous.from)).toBe(iso(at(2026, 9, 25)));
    expect(iso(s.previous.to)).toBe(iso(at(2026, 9, 28)));
  });

  it("a cycle cut short by its month compares with the one from the chosen day", () => {
    // 31 chosen: this cycle starts 28 Feb 2027, the one before on 31 Jan
    const c = { from: at(2027, 2, 28), to: at(2027, 3, 31) };
    const s = sameSpanRanges(c, new Date("2027-03-01T08:00:00Z"), 31); // 1 Mar
    expect(iso(s.previous.from)).toBe(iso(at(2027, 1, 31)));
  });

  it("the two spans are never longer than each other's month and never overlap", () => {
    const s = sameSpanRanges(cycle, new Date("2026-10-20T08:00:00Z"));
    expect(s.previous.to.getTime()).toBeLessThanOrEqual(s.current.from.getTime());
  });
});

const r = (name: string, baht: number) => ({ name, amountSatang: baht * 100 });

describe("buildCompareRows", () => {
  it("joins by name and describes each change", () => {
    const rows = buildCompareRows(
      [r("อาหาร", 150), r("เดินทาง", 80), r("บันเทิง", 50), r("ที่พัก", 100)],
      [r("อาหาร", 100), r("เดินทาง", 100), r("ที่พัก", 100), r("สุขภาพ", 30)],
    );
    const by = Object.fromEntries(rows.map((x) => [x.name, x]));
    expect(by["อาหาร"]).toMatchObject({ kind: "up", changePercent: 50 });
    expect(by["เดินทาง"]).toMatchObject({ kind: "down", changePercent: -20 });
    expect(by["บันเทิง"]).toMatchObject({ kind: "new", changePercent: null, previousSatang: 0 });
    expect(by["ที่พัก"]).toMatchObject({ kind: "same", changePercent: 0 });
    expect(by["สุขภาพ"]).toMatchObject({ kind: "gone", changePercent: -100, currentSatang: 0 });
  });

  it("biggest now first, then the ones that only existed before", () => {
    const rows = buildCompareRows([r("ก", 10), r("ข", 50)], [r("ค", 70), r("ก", 5)]);
    expect(rows.map((x) => x.name)).toEqual(["ข", "ก", "ค"]);
  });

  it("drops a category with nothing on either side", () => {
    expect(buildCompareRows([r("ก", 0)], [r("ก", 0), r("ข", 0)])).toEqual([]);
  });

  it("adds a category that appears twice in one list", () => {
    const rows = buildCompareRows([r("ก", 10), r("ก", 15)], [r("ก", 20)]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ currentSatang: 2500, previousSatang: 2000, changePercent: 25 });
  });

  it("past the limit the rest is one line that adds both sides", () => {
    const cur = Array.from({ length: 10 }, (_, i) => r(`หมวด${i}`, 100 - i));
    const prev = Array.from({ length: 10 }, () => r("ไม่ตรง", 1));
    const rows = buildCompareRows(cur, prev, 8);
    expect(rows).toHaveLength(9);
    const other = rows.at(-1)!;
    expect(other.other).toBe(true);
    expect(other.name).toBe("อื่นๆ (3 หมวด)"); // 2 more of cur + the unmatched previous one
    expect(other.currentSatang).toBe((92 + 91) * 100);
  });

  it("nothing on either side gives no rows", () => {
    expect(buildCompareRows([], [])).toEqual([]);
  });
});

describe("describeTotals", () => {
  it("rounds to a whole percent and never divides by zero", () => {
    expect(describeTotals(12_345, 10_000)).toMatchObject({ kind: "up", changePercent: 23 });
    expect(describeTotals(5000, 0)).toMatchObject({ kind: "new", changePercent: null });
    expect(describeTotals(0, 0)).toMatchObject({ kind: "same", changePercent: null });
    expect(describeTotals(0, 500)).toMatchObject({ kind: "gone", changePercent: -100 });
  });
});
