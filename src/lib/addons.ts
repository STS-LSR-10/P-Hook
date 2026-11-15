/** Add-on boosters: extra quota bought on top of a plan. */
export type AddonKind =
  "storage" | "alerts" | "slips" | "group_slots" | "private_push" | "group_push";

/** Packs bought once that count down in `remaining` (the rest are fixed amounts that renew or stay). */
export const isCountdownPack = (kind: string): boolean =>
  kind === "slips" || kind === "private_push" || kind === "group_push";

export interface AddonSku {
  sku: string;
  kind: AddonKind;
  label: string;
  /** What it adds: GB, slip reads, LINE pushes or LINE groups, by kind. */
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
  { sku: "slips_120", kind: "slips", label: "Slip Pack 120", units: 120, baht: 19, monthly: false },
  { sku: "slips_350", kind: "slips", label: "Slip Pack 350", units: 350, baht: 49, monthly: false },
  {
    sku: "ppush_50",
    kind: "private_push",
    label: "Reminder Pack Personal S",
    units: 50,
    baht: 19,
    monthly: false,
  },
  {
    sku: "ppush_100",
    kind: "private_push",
    label: "Reminder Pack Personal M",
    units: 100,
    baht: 29,
    monthly: false,
  },
  {
    sku: "ppush_250",
    kind: "private_push",
    label: "Reminder Pack Personal L",
    units: 250,
    baht: 49,
    monthly: false,
  },
  {
    sku: "gpush_60",
    kind: "group_push",
    label: "Reminder Pack Group S",
    units: 60,
    baht: 19,
    monthly: false,
  },
  {
    sku: "gpush_180",
    kind: "group_push",
    label: "Reminder Pack Group M",
    units: 180,
    baht: 35,
    monthly: false,
  },
  {
    sku: "gpush_450",
    kind: "group_push",
    label: "Reminder Pack Group L",
    units: 450,
    baht: 69,
    monthly: false,
  },
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
  /** Slip reads left in packs. */
  slips: number;
  /** Extra LINE group ledgers. */
  groups: number;
  /** Pushes left in packs: reminders to the person's own chat, and messages into their groups. */
  privatePush: number;
  groupPush: number;
}

export const NO_BONUS: Bonus = {
  storageBytes: 0,
  slips: 0,
  groups: 0,
  privatePush: 0,
  groupPush: 0,
};

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
    else if (r.kind === "private_push") out.privatePush += r.remaining ?? 0;
    else if (r.kind === "group_push") out.groupPush += r.remaining ?? 0;
    else if (r.kind === "slips") out.slips += r.remaining ?? 0;
    else if (r.kind === "group_slots") out.groups += r.units;
  }
  return out;
}
