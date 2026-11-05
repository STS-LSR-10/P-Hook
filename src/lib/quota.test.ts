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
  fileSaves: 3,
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

  it("Free: slips by the week, one voice try, one repeating reminder, no groups", () => {
    const q = byKey("free");
    expect(q.slips).toMatchObject({ used: 2, limit: 3, period: "week", word: "ครั้ง" });
    expect(q.voice).toMatchObject({ used: 1, limit: 1, period: "once" });
    expect(q.reminders).toMatchObject({ used: 3, limit: 3, period: "total" });
    expect(q.repeatReminders).toMatchObject({ used: 1, limit: 1 });
    expect(q.groups?.limit).toBe(0);
    expect(q.groupReminders?.limit).toBe(0);
    expect(q.pdf?.limit).toBe(0);
    expect(q.storage).toMatchObject({ used: 1024, limit: 500 * 1024 * 1024, unit: "bytes" });
    expect(q.owl).toMatchObject({ limit: 5, period: "month" });
    expect(q.ai).toMatchObject({ limit: 200, period: "month", label: "ถาม AI" });
  });

  it("Pro: monthly slips and voice, 10 repeating reminders, groups still Elite", () => {
    const q = byKey("plus");
    expect(q.slips).toMatchObject({ limit: 30, period: "month" });
    expect(q.voice).toMatchObject({ limit: 20, period: "month" });
    expect(q.repeatReminders?.limit).toBe(10);
    expect(q.groups?.limit).toBe(0);
    expect(q.photos?.limit).toBe(100);
  });

  it("Elite: 5 groups, 200 group reminders a month, slips with no plan limit", () => {
    const q = byKey("ultimate");
    expect(q.groups).toMatchObject({ used: 2, limit: 5, period: "total" });
    expect(q.groupReminders).toMatchObject({ used: 40, limit: 200, period: "month" });
    expect(q.repeatReminders?.limit).toBe(30);
    expect(q.slips?.limit).toBeNull();
    expect(q.slips?.hint).toContain("300");
  });

  it("each item says what every plan gets, so they can be compared", () => {
    const slips = byKey("plus").slips;
    expect(slips?.plans).toEqual({
      free: { limit: 3, period: "week" },
      plus: { limit: 30, period: "month" },
      ultimate: { limit: null, period: "month" },
    });
  });
});
