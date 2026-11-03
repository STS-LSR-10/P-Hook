import { AsyncLocalStorage } from "node:async_hooks";
import { isHomeCurrency } from "@/lib/currency";
import { isLocale, setLocaleSource } from "@/lib/i18n";
import { setCurrencySource } from "@/lib/money";
import { setZoneSource } from "@/lib/thai-date";
import { isZone } from "@/lib/zone";

/**
 * The person of the work in hand on the server (one request, one webhook event, one person in a cron
 * run): their time zone, their currency and their language. Requests run side by side in one worker, so it lives in
 * AsyncLocalStorage, not a global. A scope starts in Bangkok and baht, and takes the person's own
 * once they are known (enterZone, enterCurrency).
 */
const scope = new AsyncLocalStorage<{
  zone: string | null;
  currency: string | null;
  locale?: string | null;
}>();
setZoneSource(() => scope.getStore()?.zone);
setCurrencySource(() => scope.getStore()?.currency);
setLocaleSource(() => scope.getStore()?.locale);

/** Run with a scope whose zone and currency are set later, when the person is known. */
export function withZoneScope<T>(fn: () => T): T {
  return scope.run({ zone: null, currency: null, locale: null }, fn);
}

/** Run in that zone and currency (ones we do not offer are Bangkok and the baht). */
export function runInZone<T>(
  zone: string | null | undefined,
  fn: () => T,
  currency?: string | null,
  locale?: string | null,
): T {
  return scope.run(
    {
      zone: isZone(zone) ? zone : null,
      currency: isHomeCurrency(currency) ? currency : null,
      locale: isLocale(locale) ? locale : null,
    },
    fn,
  );
}

/** The person is known: the rest of this scope is in their zone. Outside a scope it does nothing. */
export function enterZone(zone: string | null | undefined): void {
  const store = scope.getStore();
  if (store && isZone(zone)) store.zone = zone;
}

/** The person is known: the rest of this scope shows amounts in their currency. */
export function enterCurrency(currency: string | null | undefined): void {
  const store = scope.getStore();
  if (store && isHomeCurrency(currency)) store.currency = currency;
}

/** The person is known: the rest of this scope speaks their language (messages, dates). */
export function enterLocale(locale: string | null | undefined): void {
  const store = scope.getStore();
  if (store && isLocale(locale)) store.locale = locale;
}
