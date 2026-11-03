import { EN } from "@/lib/i18n-en";

/** The languages a person can pick. Thai is the app's own; English comes from a dictionary. */
export const LOCALES = ["th", "en"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "th";

export const isLocale = (v: unknown): v is Locale =>
  typeof v === "string" && (LOCALES as readonly string[]).includes(v);

/** Where the browser remembers the person's language (see liff-provider). */
export const LOCALE_KEY = "phook-locale";

/**
 * In the browser, the language remembered from the last sign-in, read before any page code runs:
 * every file that has words imports this one first, so words made when a file loads are right too.
 */
function rememberedLocale(): string | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage.getItem(LOCALE_KEY);
  } catch {
    return null;
  }
}
const remembered = rememberedLocale();
/** The language this page was loaded in (Thai unless the browser remembered another). */
export const loadedLocale = (): Locale => (isLocale(remembered) ? remembered : DEFAULT_LOCALE);

let localeSource: (() => string | null | undefined) | null = isLocale(remembered)
  ? () => remembered
  : null;

/** Where the language comes from: the request on the server, the signed-in person in the page. */
export function setLocaleSource(source: (() => string | null | undefined) | null): void {
  localeSource = source;
}

/** The language words are shown in now (Thai unless set). */
export function currentLocale(): Locale {
  let v: string | null | undefined;
  try {
    v = localeSource?.();
  } catch {
    v = null;
  }
  return isLocale(v) ? v : DEFAULT_LOCALE;
}

type Value = string | number | null | undefined;
// a value is written as a template literal would write it
const fill = (text: string, values: readonly Value[]) =>
  values.length === 0
    ? text
    : text.replace(/\{(\d+)\}/g, (m, i) => (Number(i) < values.length ? String(values[Number(i)]) : m));

/**
 * The words in the person's language: `th` as written, or its English. "{0}", "{1}" in it are
 * replaced by `values`. A phrase with no English yet stays Thai (never blank).
 */
export function t(th: string, ...values: Value[]): string {
  const text = currentLocale() === "en" ? (EN[th] ?? th) : th;
  return fill(text, values);
}
