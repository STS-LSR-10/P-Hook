/** The currency a person keeps their books in: the baht unless they chose another in settings. */
export const DEFAULT_CURRENCY = "THB";

/**
 * The baht, then every currency the rate source knows (so other currencies can be turned into it):
 * the same as SUPPORTED_CURRENCIES of the parser, written out here so money.ts can use this file
 * without importing the parser (which imports money.ts). A test keeps the two lists alike.
 */
export const HOME_CURRENCIES: readonly string[] = [
  DEFAULT_CURRENCY,
  "USD",
  "EUR",
  "GBP",
  "JPY",
  "CNY",
  "KRW",
  "SGD",
  "MYR",
  "HKD",
  "AUD",
  "CAD",
  "CHF",
  "INR",
  "IDR",
  "NZD",
  "PHP",
  "SEK",
  "NOK",
  "DKK",
];

const INFO: Record<string, { name: string; symbol: string; cents: boolean }> = {
  THB: { name: "Thai Baht", symbol: "฿", cents: true },
  USD: { name: "US Dollar", symbol: "$", cents: true },
  EUR: { name: "Euro", symbol: "€", cents: true },
  GBP: { name: "British Pound", symbol: "£", cents: true },
  JPY: { name: "Japanese Yen", symbol: "¥", cents: false },
  CNY: { name: "Chinese Yuan", symbol: "CN¥", cents: true },
  KRW: { name: "South Korean Won", symbol: "₩", cents: false },
  SGD: { name: "Singapore Dollar", symbol: "S$", cents: true },
  MYR: { name: "Malaysian Ringgit", symbol: "RM", cents: true },
  HKD: { name: "Hong Kong Dollar", symbol: "HK$", cents: true },
  AUD: { name: "Australian Dollar", symbol: "A$", cents: true },
  CAD: { name: "Canadian Dollar", symbol: "C$", cents: true },
  CHF: { name: "Swiss Franc", symbol: "CHF ", cents: true },
  INR: { name: "Indian Rupee", symbol: "₹", cents: true },
  IDR: { name: "Indonesian Rupiah", symbol: "Rp", cents: false },
  NZD: { name: "New Zealand Dollar", symbol: "NZ$", cents: true },
  PHP: { name: "Philippine Peso", symbol: "₱", cents: true },
  SEK: { name: "Swedish Krona", symbol: "kr ", cents: true },
  NOK: { name: "Norwegian Krone", symbol: "kr ", cents: true },
  DKK: { name: "Danish Krone", symbol: "kr ", cents: true },
};

export const isHomeCurrency = (code: unknown): code is string =>
  typeof code === "string" && HOME_CURRENCIES.includes(code) && code in INFO;

/** The sign in front of an amount ("฿", "$", "CHF "). */
export const symbolOf = (code: string): string => INFO[code]?.symbol ?? `${code} `;

/** Whether amounts in it are shown with cents (the yen, won and rupiah are not). */
export const hasCents = (code: string): boolean => INFO[code]?.cents ?? true;

/** "Thai Baht (฿)" for the list in settings. */
export const currencyLabel = (code: string): string =>
  `${INFO[code]?.name ?? code} (${symbolOf(code).trim()})`;
