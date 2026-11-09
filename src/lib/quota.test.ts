import { describe, expect, it } from "vitest";
import { buildQuota, type QuotaUsage } from "./quota";

const USED: QuotaUsage = {
  storageBytes: 1024,
  groupStorageBytes: 0,
  wallets: 2,
  goals: 1,
  notes: 12,
  reminders: 3,
  repeatReminders: 1,
  recurring: 4,
  groups: 2,
  groupReminders: 40,
  slips: 2,
  photos: 5,
  voice: 1,
  pdf: 0,
  owl: 7,
  ai: 9,
};

const byKey = (plan: Parameters<typeof buildQuota>[0]) => {
  const q = buildQuota(plan, USED);
  return Object.fromEntries([...q.main, ...q.others].map((i) => [i.key, i]));
};

describe("buildQuota", () => {
  it("splits the space into the person's own and their groups' when groups keep files", () => {
    const storage = (groupStorageBytes: number) =>
      [
        ...buildQuota("ultimate", { ...USED, storageBytes: 3 * 1024 * 1024, groupStorageBytes })
          .main,
      ].find((i) => i.key === "storage");
    expect(storage(1024 * 1024)?.hint).toContain("ส่วนตัว 2 MB · กลุ่ม 1 MB");
    expect(storage(1024 * 1024)?.used).toBe(3 * 1024 * 1024);
    expect(storage(0)?.hint).not.toContain("ส่วนตัว");
  });

  it("leads with the seven of the design, in its order", () => {
    expect(buildQuota("plus", USED).main.map((i) => i.key)).toEqual([
      "slips",
      "pdf",
      "groups",
      "reminders",
      "repeatReminders",
      "groupReminders",
      "storage",
    ]);
  });

  it("Free: ten slips and ten voice tries for life, a few reminders, no groups", () => {
    const q = byKey("free");
    expect(q.slips).toMatchObject({ used: 2, limit: 10, period: "once", word: "ครั้ง" });
    expect(q.voice).toMatchObject({ used: 1, limit: 10, period: "once" });
    expect(q.reminders).toMatchObject({ used: 3, limit: 10, period: "total" });
    expect(q.repeatReminders).toMatchObject({ used: 1, limit: 5 });
    expect(q.groups?.limit).toBe(0);
    expect(q.groupReminders?.limit).toBe(0);
    expect(q.pdf?.limit).toBe(0);
    expect(q.storage).toMatchObject({ used: 1024, limit: 500 * 1024 * 1024, unit: "bytes" });
    expect(q.owl).toMatchObject({ limit: 5, period: "month" });
    expect(q.ai).toMatchObject({ limit: 200, period: "month", label: "ถาม AI" });
    expect(q.fileSaves).toBeUndefined(); // no daily limit on saving files any more
  });

  it("Starter: monthly slips and voice, one group of five, no PDF yet", () => {
    const q = byKey("starter");
    expect(q.slips).toMatchObject({ limit: 60, period: "month" });
    expect(q.voice).toMatchObject({ limit: 30, period: "month" });
    expect(q.repeatReminders?.limit).toBe(20);
    expect(q.groups).toMatchObject({ used: 2, limit: 1, period: "total" });
    expect(q.groupReminders).toMatchObject({ limit: 50, period: "month" });
    expect(q.pdf?.limit).toBe(0);
    expect(q.wallets?.limit).toBe(5);
    expect(q.goals?.limit).toBe(2);
    expect(q.recurring?.limit).toBe(20);
  });

  it("Pro: more of everything, and PDFs", () => {
    const q = byKey("plus");
    expect(q.slips).toMatchObject({ limit: 250, period: "month" });
    expect(q.voice).toMatchObject({ limit: 200, period: "month" });
    expect(q.repeatReminders?.limit).toBe(50);
    expect(q.groups?.limit).toBe(5);
    expect(q.photos?.limit).toBe(100);
    expect(q.pdf?.limit).toBe(10);
    expect(q.storage?.limit).toBe(20 * 1024 ** 3);
  });

  it("Elite: 10 groups, 500 group reminders a month, a real slip limit, unlimited goals", () => {
    const q = byKey("ultimate");
    expect(q.groups).toMatchObject({ used: 2, limit: 10, period: "total" });
    expect(q.groupReminders).toMatchObject({ used: 40, limit: 500, period: "month" });
    expect(q.repeatReminders?.limit).toBe(100);
    expect(q.slips?.limit).toBe(600);
    expect(q.goals?.limit).toBeNull();
    expect(q.storage?.limit).toBe(100 * 1024 ** 3);
  });

  it("each item says what every plan gets, so they can be compared", () => {
    const slips = byKey("plus").slips;
    expect(slips?.plans).toEqual({
      free: { limit: 10, period: "once" },
      starter: { limit: 60, period: "month" },
      plus: { limit: 250, period: "month" },
      ultimate: { limit: 600, period: "month" },
    });
  });
});
