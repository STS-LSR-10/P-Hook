import { describe, expect, it } from "vitest";
import { ADDONS, NO_BONUS, sumBonus, addonBySku, addonForSale } from "./addons";
import { fileCapacity } from "./file";
import { buildQuota } from "./quota";
import { capacityOf, reminderCapacity } from "./user-reminder";

const NOW = new Date("2026-11-10T00:00:00Z");
const GB = 1024 ** 3;

describe("sumBonus", () => {
  it("adds what is bought, skips what has expired, and counts a slip pack by what is left", () => {
    const b = sumBonus(
      [
        { kind: "storage", units: 10, remaining: null, expires_at: "2026-12-01T00:00:00Z" },
        { kind: "storage", units: 30, remaining: null, expires_at: "2026-11-01T00:00:00Z" }, // ended
        { kind: "alerts", units: 50, remaining: null, expires_at: null },
        { kind: "slips", units: 100, remaining: 64, expires_at: null },
        { kind: "group_slots", units: 2, remaining: null, expires_at: "2026-12-01T00:00:00Z" },
        { kind: "group_slots", units: 2, remaining: null, expires_at: "2026-12-05T00:00:00Z" },
      ],
      NOW,
    );
    expect(b).toEqual({ storageBytes: 10 * GB, alerts: 50, slips: 64, groups: 4 });
  });

  it("the catalogue matches the price list", () => {
    expect(ADDONS.map((a) => [a.sku, a.units, a.baht, a.monthly])).toEqual([
      ["storage_15", 15, 19, true],
      ["storage_40", 40, 35, true],
      ["storage_70", 70, 55, true],
      ["alerts_70", 70, 19, false],
      ["alerts_200", 200, 39, false],
      ["slips_120", 120, 19, false],
      ["slips_350", 350, 49, false],
      ["groups_3", 3, 29, true],
    ]);
    // packs bought before the change still renew, but cannot be bought again
    expect(addonBySku("storage_10")).toMatchObject({ units: 10, baht: 15 });
    expect(addonForSale("storage_10")).toBeUndefined();
    expect(addonForSale("storage_15")).toBeDefined();
    expect(addonBySku("nope")).toBeUndefined();
  });
});

describe("capacities with add-ons", () => {
  it("storage and waiting reminders grow; repeating reminders do not", () => {
    expect(fileCapacity("starter", 10 * GB)).toBe(13 * GB);
    expect(reminderCapacity("starter", 50)).toBe(100);
    expect(capacityOf("starter", "once", 50)).toBe(100);
    expect(capacityOf("starter", "repeat", 50)).toBe(20);
  });
});

describe("the quota page with add-ons", () => {
  const used = {
    storageBytes: 0,
    groupStorageBytes: 0,
    wallets: 0,
    goals: 0,
    notes: 0,
    reminders: 0,
    repeatReminders: 0,
    groups: 0,
    groupReminders: 0,
    recurring: 0,
    slips: 70,
    photos: 0,
    voice: 0,
    pdf: 0,
    owl: 0,
    ai: 0,
  };
  const find = (q: ReturnType<typeof buildQuota>, key: string) =>
    q.main.find((i) => i.key === key)!;

  it("shows the plan's slips as used and the pack as what is left", () => {
    const q = buildQuota("starter", used, { ...NO_BONUS, slips: 40 });
    const s = find(q, "slips");
    expect(s.limit).toBe(45 + 40);
    expect(s.used).toBe(45); // 70 read: 45 by the plan, 25 by the pack, which has 40 left
  });

  it("adds storage, groups and waiting reminders to the person's own limits only", () => {
    const q = buildQuota("starter", used, {
      storageBytes: 10 * GB,
      alerts: 50,
      slips: 0,
      groups: 2,
    });
    expect(find(q, "storage").limit).toBe(13 * GB);
    expect(find(q, "reminders").limit).toBe(100);
    expect(find(q, "groups").limit).toBe(3);
    expect(find(q, "storage").plans.starter.limit).toBe(3 * GB); // the plan table is unchanged
  });
});
