import { toSatang } from "@/lib/money";
import { t } from "@/lib/i18n";

export const WALLET_KINDS = ["cash", "bank", "card", "savings", "ewallet"] as const;
export type WalletKind = (typeof WALLET_KINDS)[number];

export const WALLET_KIND_LABEL: Record<WalletKind, string> = {
  cash: t("เงินสด"),
  bank: t("บัญชีธนาคาร"),
  card: t("บัตรเครดิต"),
  savings: t("เงินเก็บ"),
  ewallet: t("อีวอลเล็ต"),
};

export const WALLET_KIND_EMOJI: Record<WalletKind, string> = {
  cash: "💵",
  bank: "🏦",
  card: "💳",
  savings: "🐷",
  ewallet: "📱",
};

export const DEFAULT_WALLET_NAME = "เงินสด";
export const MAX_WALLET_NAME = 30;

export interface Wallet {
  id: string;
  name: string;
  kind: WalletKind;
  isDefault: boolean;
  /** Integer satang; may be negative (a card). */
  openingSatang: number;
  incomeSatang: number;
  expenseSatang: number;
  /** Moved in / out by transfers between wallets (not income or expense). */
  transferInSatang: number;
  transferOutSatang: number;
  /** Money gained / lost through debts (borrowed, lent, repayments). Not income or expense. */
  debtInSatang: number;
  debtOutSatang: number;
  entryCount: number;
  /** Credit-card wallets: the limit and the two days of the month (all optional). */
  creditLimitSatang: number | null;
  statementDay: number | null;
  dueDay: number | null;
  /** A wallet two or more people write into (set only for wallets from migration 0029). */
  shared?: boolean;
  /** Who owns it; for a private wallet this is always the person asking. */
  ownerId?: string;
  /** People on it, the owner included. */
  memberCount?: number;
}

/** Opening balance + income - expense + transfers in - transfers out, in satang. */
export function balanceOf(
  w: Pick<
    Wallet,
    | "openingSatang"
    | "incomeSatang"
    | "expenseSatang"
    | "transferInSatang"
    | "transferOutSatang"
    | "debtInSatang"
    | "debtOutSatang"
  >,
): number {
  return (
    w.openingSatang +
    w.incomeSatang -
    w.expenseSatang +
    w.transferInSatang -
    w.transferOutSatang +
    w.debtInSatang -
    w.debtOutSatang
  );
}

export function totalBalance(wallets: Wallet[]): number {
  return wallets.reduce((sum, w) => sum + balanceOf(w), 0);
}

/** A wallet as the web app receives it (satang as integers, the balance worked out). */
export function walletToDto(w: Wallet) {
  return {
    id: w.id,
    name: w.name,
    kind: w.kind,
    isDefault: w.isDefault,
    openingSatang: w.openingSatang,
    incomeSatang: w.incomeSatang,
    expenseSatang: w.expenseSatang,
    transferInSatang: w.transferInSatang,
    transferOutSatang: w.transferOutSatang,
    debtInSatang: w.debtInSatang,
    debtOutSatang: w.debtOutSatang,
    balanceSatang: balanceOf(w),
    entryCount: w.entryCount,
    creditLimitSatang: w.creditLimitSatang,
    statementDay: w.statementDay,
    dueDay: w.dueDay,
    shared: w.shared === true,
    memberCount: w.memberCount ?? 1,
  };
}

export const walletLabel = (w: Pick<Wallet, "name" | "kind"> & { shared?: boolean }) =>
  `${WALLET_KIND_EMOJI[w.kind]} ${w.name}${w.shared ? " 👥" : ""}`;

/** Wallets the person owns (a shared wallet they only belong to is not theirs to count or change). */
export const ownedWallets = <T extends Pick<Wallet, "ownerId">>(
  wallets: T[],
  userId: string,
): T[] => wallets.filter((w) => w.ownerId === undefined || w.ownerId === userId);

export type WalletMatch =
  { ok: true; wallet: Wallet } | { ok: false; reason: "none" | "ambiguous" };

/**
 * The wallet a typed "@word" means: the one with exactly that name (ignoring case), else the only
 * one whose name starts with it. Never a guess between several.
 */
export function resolveWallet(hint: string, wallets: Wallet[]): WalletMatch {
  const word = hint.trim().toLowerCase();
  if (!word) return { ok: false, reason: "none" };
  const exact = wallets.filter((w) => w.name.toLowerCase() === word);
  if (exact.length === 1 && exact[0]) return { ok: true, wallet: exact[0] };
  const starts = wallets.filter((w) => w.name.toLowerCase().startsWith(word));
  if (starts.length === 1 && starts[0]) return { ok: true, wallet: starts[0] };
  return { ok: false, reason: starts.length > 1 ? "ambiguous" : "none" };
}

/** A decimal typed for the opening balance ("1,200.50", "-500") as satang, or null if invalid. */
export function parseOpeningBalance(input: unknown): number | null {
  if (input === null || input === undefined || input === "") return 0;
  const text = String(input).replace(/,/g, "").trim();
  if (!/^-?\d{1,10}(\.\d{1,2})?$/.test(text)) return null;
  return toSatang(text);
}

/** A credit limit typed in baht as satang: null when empty, undefined when invalid or not above zero. */
export function parseCreditLimit(input: unknown): number | null | undefined {
  if (input === null || input === undefined || input === "") return null;
  const text = String(input).replace(/,/g, "").trim();
  if (!/^\d{1,10}(\.\d{1,2})?$/.test(text)) return undefined;
  const satang = toSatang(text);
  return satang > 0 ? satang : undefined;
}
