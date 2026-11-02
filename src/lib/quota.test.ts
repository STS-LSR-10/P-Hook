import { describe, expect, it } from "vitest";
import { buildQuota, type QuotaUsage } from "./quota";

const USED: QuotaUsage = {
  storageBytes: 1024,
  wallets: 2,
  goals: 1,
  notes: 12,
  reminders: 3,
  recurring: 4,
  slips: 2,
  photos: 5,
  voice: 1,
  pdf: 0,
  owl: 7,
  router: 9,
  fileSaves: 3,
};

const byKey = (plan: Parameters<typeof buildQuota>[0]) => {
  const q = buildQuota(plan, USED);
  return Object.fromEntries([...q.kept, ...q.counted].map((i) => [i.key, i]));
};

describe("buildQuota", () => {
  it("Free: the plan's limits, slips by the week, one voice taste, paid-only things at 0", () => {
    const q = byKey("free");
    expect(q.storage).toMatchObject({ used: 1024, limit: 500 * 1024 * 1024, unit: "bytes" });
    expect(q.reminders).toMatchObject({ used: 3, limit: 3, period: "total" });
    expect(q.notes).toMatchObject({ limit: 30 });
    expect(q.slips).toMatchObject({ used: 2, limit: 3, period: "week" });
    expect(q.voice).toMatchObject({ used: 1, limit: 1, period: "once" });
    expect(q.recurring?.limit).toBe(0);
    expect(q.goals?.limit).toBe(0);
    expect(q.pdf?.limit).toBe(0);
    expect(q.photos?.limit).toBe(0);
    expect(q.owl).toMatchObject({ limit: 5, period: "month" });
    expect(q.router).toMatchObject({ limit: 10, period: "day" });
    expect(q.fileSaves).toMatchObject({ limit: 20, period: "day" });
  });

  it("Pro: monthly slips and voice", () => {
    const q = byKey("plus");
    expect(q.slips).toMatchObject({ limit: 30, period: "month" });
    expect(q.voice).toMatchObject({ limit: 20, period: "month" });
    expect(q.photos?.limit).toBe(100);
    expect(q.storage?.limit).toBe(5 * 1024 * 1024 * 1024);
  });

  it("Elite: slips have no plan limit but say what normal use is", () => {
    const q = byKey("ultimate");
    expect(q.slips?.limit).toBeNull();
    expect(q.slips?.hint).toContain("300");
    expect(q.reminders?.limit).toBe(100);
    expect(q.router?.limit).toBe(500);
  });

  it("puts what you keep apart from what starts over", () => {
    const q = buildQuota("plus", USED);
    expect(q.kept.map((i) => i.key)).toEqual([
      "storage",
      "reminders",
      "notes",
      "recurring",
      "wallets",
      "goals",
    ]);
    expect(q.counted.every((i) => i.period !== "total")).toBe(true);
  });
});
