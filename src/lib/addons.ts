/** Add-on boosters: extra quota bought on top of a plan. */
export type AddonKind = "storage" | "alerts" | "slips" | "group_slots";

export interface AddonSku {
  sku: string;
  kind: AddonKind;
  label: string;
  /** What it adds: GB, waiting reminders, slip reads or LINE groups, by kind. */
  units: number;
  /** Whole baht. */
  baht: number;
  /** Renews every month (storage, group slots); otherwise bought once and kept. */
  monthly: boolean;
}

/** On sale now. */
export const ADDONS: AddonSku[] = [
  {
    sku: "storage_15",
    kind: "storage",
    label: "Storage Pack 15GB",
    units: 15,
    baht: 19,
    monthly: true,
  },
  {
    sku: "storage_40",
    kind: "storage",
    label: "Storage Pack 40GB",
    units: 40,
    baht: 35,
    monthly: true,
  },
  {
    sku: "storage_70",
    kind: "storage",
    label: "Storage Pack 70GB",
    units: 70,
    baht: 55,
    monthly: true,
  },
  {
    sku: "alerts_70",
    kind: "alerts",
    label: "Alert Booster S",
    units: 70,
    baht: 19,
    monthly: false,
  },
  {
    sku: "alerts_200",
    kind: "alerts",
    label: "Alert Booster L",
    units: 200,
    baht: 39,
    monthly: false,
  },
  { sku: "slips_120", kind: "slips", label: "Slip Pack 120", units: 120, baht: 19, monthly: false },
  { sku: "slips_350", kind: "slips", label: "Slip Pack 350", units: 350, baht: 49, monthly: false },
  {
    sku: "groups_3",
    kind: "group_slots",
    label: "Extra Group Slot",
    units: 3,
    baht: 29,
    monthly: true,
  },
];

/** No longer sold, but kept so subscriptions bought earlier renew with what they paid for. */
export const RETIRED_ADDONS: AddonSku[] = [
  {
    sku: "storage_10",
    kind: "storage",
    label: "Storage Pack 10GB",
    units: 10,
    baht: 15,
    monthly: true,
  },
  {
    sku: "storage_30",
    kind: "storage",
    label: "Storage Pack 30GB",
    units: 30,
    baht: 29,
    monthly: true,
  },
  {
    sku: "storage_50",
    kind: "storage",
    label: "Storage Pack 50GB",
    units: 50,
    baht: 45,
    monthly: true,
  },
  {
    sku: "alerts_s",
    kind: "alerts",
    label: "Alert Booster S",
    units: 50,
    baht: 15,
    monthly: false,
  },
  {
    sku: "alerts_l",
    kind: "alerts",
    label: "Alert Booster L",
    units: 150,
    baht: 35,
    monthly: false,
  },
  { sku: "slips_100", kind: "slips", label: "Slip Pack 100", units: 100, baht: 19, monthly: false },
  { sku: "slips_300", kind: "slips", label: "Slip Pack 300", units: 300, baht: 49, monthly: false },
  {
    sku: "groups_2",
    kind: "group_slots",
    label: "Extra Group Slot",
    units: 2,
    baht: 29,
    monthly: true,
  },
];

export const addonForSale = (sku: string): AddonSku | undefined =>
  ADDONS.find((a) => a.sku === sku);

/** Any pack ever sold, for renewals and reports. */
export const addonBySku = (sku: string): AddonSku | undefined =>
  [...ADDONS, ...RETIRED_ADDONS].find((a) => a.sku === sku);

/** The extra quota a person has right now, summed over what they bought and has not run out. */
export interface Bonus {
  storageBytes: number;
  /** Extra waiting (one-off) reminders. */
  alerts: number;
  /** Slip reads left in packs. */
  slips: number;
  /** Extra LINE group ledgers. */
  groups: number;
}

export const NO_BONUS: Bonus = { storageBytes: 0, alerts: 0, slips: 0, groups: 0 };

const GB = 1024 ** 3;

export interface AddonRow {
  kind: string;
  units: number;
  remaining: number | null;
  expires_at: string | null;
}

export function sumBonus(rows: AddonRow[], now: Date): Bonus {
  const out = { ...NO_BONUS };
  for (const r of rows) {
    if (r.expires_at && Date.parse(r.expires_at) <= now.getTime()) continue;
    if (r.kind === "storage") out.storageBytes += r.units * GB;
    else if (r.kind === "alerts") out.alerts += r.units;
    else if (r.kind === "slips") out.slips += r.remaining ?? 0;
    else if (r.kind === "group_slots") out.groups += r.units;
  }
  return out;
}
