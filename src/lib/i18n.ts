import { EN } from "@/lib/i18n-en";

/** The languages a person can pick. Thai is the app's own; English comes from a dictionary. */
export const LOCALES = ["th", "en"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "th";

export const isLocale = (v: unknown): v is Locale =>
  typeof v === "string" && (LOCALES as readonly string[]).includes(v);

let localeSource: (() => string | null | undefined) | null = null;

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

const fill = (text: string, values: readonly (string | number)[]) =>
  values.length === 0 ? text : text.replace(/\{(\d+)\}/g, (m, i) => String(values[Number(i)] ?? m));

/**
 * The words in the person's language: `th` as written, or its English. "{0}", "{1}" in it are
 * replaced by `values`. A phrase with no English yet stays Thai (never blank).
 */
export function t(th: string, ...values: (string | number)[]): string {
  const text = currentLocale() === "en" ? (EN[th] ?? th) : th;
  return fill(text, values);
}
