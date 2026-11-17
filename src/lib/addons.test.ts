import { describe, expect, it } from "vitest";
import { ADDONS, NO_BONUS, sumBonus, addonBySku, addonForSale } from "./addons";
import { fileCapacity } from "./file";
import { buildQuota } from "./quota";
import { capacityOf } from "./user-reminder";

const NOW = new Date("2026-11-10T00:00:00Z");
const GB = 1024 ** 3;

describe("sumBonus", () => {
  it("adds what is bought, skips what has expired, and counts a slip pack by what is left", () => {
    const b = sumBonus(
      [
        { kind: "storage", units: 10, remaining: null, expires_at: "2026-12-01T00:00:00Z" },
        { kind: "storage", units: 30, remaining: null, expires_at: "2026-11-01T00:00:00Z" }, // ended
        { kind: "alerts", units: 50, remaining: null, expires_at: null }, // retired: counts for nothing
        { kind: "private_push", units: 50, remaining: 12, expires_at: null },
        { kind: "group_push", units: 100, remaining: 100, expires_at: null },
        { kind: "group_push", units: 60, remaining: 0, expires_at: null },
        { kind: "slips", units: 100, remaining: 64, expires_at: null },
        { kind: "group_slots", units: 2, remaining: null, expires_at: "2026-12-01T00:00:00Z" },
        { kind: "group_slots", units: 2, remaining: null, expires_at: "2026-12-05T00:00:00Z" },
      ],
      NOW,
    );
    expect(b).toEqual({
      storageBytes: 10 * GB,
      slips: 64,
      groups: 4,
      privatePush: 12,
      groupPush: 100,
      ai: 0,
    });
  });

  it("the catalogue matches the price list", () => {
    expect(ADDONS.map((a) => [a.sku, a.units, a.baht, a.monthly])).toEqual([
      ["storage_15", 15, 19, true],
      ["storage_40", 40, 35, true],
      ["storage_70", 70, 55, true],
      ["slips_120", 120, 19, false],
      ["slips_350", 350, 49, false],
      ["ppush_50", 50, 19, false],
      ["ppush_100", 100, 29, false],
      ["ppush_250", 250, 49, false],
      ["gpush_60", 60, 19, false],
      ["gpush_180", 180, 35, false],
      ["gpush_450", 450, 69, false],
      ["ai_70", 70, 19, false],
      ["ai_150", 150, 29, false],
      ["ai_250", 250, 39, false],
      ["groups_3", 3, 29, true],
    ]);
    // packs bought before the change still renew, but cannot be bought again
    expect(addonBySku("storage_10")).toMatchObject({ units: 10, baht: 15 });
    expect(addonForSale("storage_10")).toBeUndefined();
    expect(addonBySku("alerts_70")).toMatchObject({ kind: "alerts" });
    expect(addonForSale("alerts_70")).toBeUndefined(); // the boosters are no longer sold
    expect(addonForSale("storage_15")).toBeDefined();
    expect(addonBySku("nope")).toBeUndefined();
  });
});

describe("capacities with add-ons", () => {
  it("storage grows; waiting reminders have no limit and repeating ones keep the plan's", () => {
    expect(fileCapacity("starter", 10 * GB)).toBe(15 * GB);
    expect(capacityOf("starter", "once")).toBe(1000);
    expect(capacityOf("starter", "repeat")).toBe(20);
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
    privatePush: 0,
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
  const findAny = (q: ReturnType<typeof buildQuota>, key: string) =>
    [...q.main, ...q.others].find((i) => i.key === key)!;

  it("shows the plan's slips as used and the pack as what is left", () => {
    const q = buildQuota("starter", used, { ...NO_BONUS, slips: 40 });
    const s = find(q, "slips");
    expect(s.limit).toBe(45 + 40);
    expect(s.used).toBe(45); // 70 read: 45 by the plan, 25 by the pack, which has 40 left
  });

  it("adds storage, groups and push packs to the person's own limits only", () => {
    const q = buildQuota("starter", used, {
      storageBytes: 10 * GB,
      slips: 0,
      groups: 2,
      privatePush: 40,
      groupPush: 100,
      ai: 0,
    });
    expect(find(q, "storage").limit).toBe(15 * GB);
    expect(find(q, "reminders").limit).toBe(50 + 40); // one-off reminders pushed to LINE
    expect(findAny(q, "groupReminders").limit).toBe(0 + 100);
    expect(find(q, "groups").limit).toBe(2);
    expect(find(q, "storage").plans.starter.limit).toBe(5 * GB); // the plan table is unchanged
  });
});

describe("add-ons for the groups", () => {
  it("are sold only to plans that have group ledgers", async () => {
    const { ADDONS, addonAllowedFor } = await import("./addons");
    const group = ADDONS.filter((a) => a.kind === "group_push" || a.kind === "group_slots");
    expect(group.length).toBeGreaterThan(0);
    for (const a of group) {
      expect(addonAllowedFor("free", a)).toBe(false);
      expect(addonAllowedFor("starter", a)).toBe(false);
      expect(addonAllowedFor("plus", a)).toBe(true);
    }
    for (const a of ADDONS.filter((x) => !group.includes(x))) {
      expect(addonAllowedFor("starter", a)).toBe(true);
    }
  });
});
