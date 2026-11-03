import { AsyncLocalStorage } from "node:async_hooks";
import { setZoneSource } from "@/lib/thai-date";
import { isZone } from "@/lib/zone";

/**
 * The zone of the work in hand on the server: one request, one webhook event, one person in a cron
 * run. Requests run side by side in one worker, so it lives in AsyncLocalStorage, not a global. A scope
 * starts in Bangkok and takes the person's zone once they are known (enterZone).
 */
const scope = new AsyncLocalStorage<{ zone: string | null }>();
setZoneSource(() => scope.getStore()?.zone);

/** Run with a scope whose zone is set later, when the person is known. */
export function withZoneScope<T>(fn: () => T): T {
  return scope.run({ zone: null }, fn);
}

/** Run in that zone (a zone we do not list is Bangkok). */
export function runInZone<T>(zone: string | null | undefined, fn: () => T): T {
  return scope.run({ zone: isZone(zone) ? zone : null }, fn);
}

/** The person is known: the rest of this scope is in their zone. Outside a scope it does nothing. */
export function enterZone(zone: string | null | undefined): void {
  const store = scope.getStore();
  if (store && isZone(zone)) store.zone = zone;
}
