"use client";

import { Splash } from "@/components/liff/splash";
import { setZoneSource } from "@/lib/thai-date";
import { isZone } from "@/lib/zone";
import { isHomeCurrency } from "@/lib/currency";
import { setCurrencySource } from "@/lib/money";
import { isLocale, setLocaleSource, t } from "@/lib/i18n";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

type Status = "loading" | "ready" | "error";

interface LiffContextValue {
  status: Status;
  error: string | null;
  /** Authenticated JSON fetch against our own /api (adds the session token, retries once on 401). */
  api: <T>(path: string, init?: RequestInit) => Promise<T>;
  /** Open a URL in the phone's own browser (the LINE in-app browser cannot download files). */
  openExternal: (url: string) => Promise<void>;
}

const LiffContext = createContext<LiffContextValue | null>(null);

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

const LIFF_ID = process.env.NEXT_PUBLIC_LIFF_ID;

const RELOGIN_KEY = "jodtang-liff-login-at";
/**
 * The person's language, remembered in this browser so the words are right from the first paint
 * (some are made when the page's code loads, before sign-in). Sign-in tells the real one: when it
 * differs, it is remembered and the page loads once more.
 */
const LOCALE_KEY = "phook-locale";

function rememberedLocale(): string | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage.getItem(LOCALE_KEY);
  } catch {
    return null;
  }
}
const startLocale = rememberedLocale();
if (isLocale(startLocale)) setLocaleSource(() => startLocale);

/**
 * Remember the language and load the page in it (after sign-in told another, or a change). A browser
 * that keeps nothing is not reloaded (it would load in the old language again, for ever): its page
 * follows the sign-in instead, words made at load staying Thai.
 */
export function switchLocale(locale: string): void {
  try {
    window.localStorage.setItem(LOCALE_KEY, locale);
  } catch {
    /* kept nothing */
  }
  if (rememberedLocale() === locale) window.location.reload();
}
const RELOGIN_WINDOW_MS = 30_000;

/**
 * Send the person to LINE to sign in again, but only once per 30 seconds. If signing in does not
 * produce a session (a server-side configuration problem, for example), looping through the login
 * redirect forever shows only a flickering page, so give up with a clear message instead.
 */
function loginOnce(liff: { login: (o: { redirectUri: string }) => void }): Promise<string> {
  try {
    const last = Number(window.sessionStorage.getItem(RELOGIN_KEY) ?? 0);
    if (Date.now() - last < RELOGIN_WINDOW_MS) {
      throw new Error(
        t("เข้าสู่ระบบไม่สำเร็จ ลองปิดแล้วเปิดใหม่อีกครั้งนะ (ถ้ายังไม่ได้ แจ้งผู้ดูแล)"),
      );
    }
    window.sessionStorage.setItem(RELOGIN_KEY, String(Date.now()));
  } catch (e) {
    if (e instanceof Error && e.message.startsWith(t("เข้าสู่ระบบ"))) throw e;
    // sessionStorage unavailable: fall through to a single normal redirect
  }
  liff.login({ redirectUri: window.location.href });
  return new Promise<string>(() => undefined); // page is navigating away
}

// Test-only switch for the Playwright suite (set at build time, never in production).
// It only skips the LINE sign-in screen on the client: every /api call still needs a valid
// server-issued session, so enabling it by mistake grants no access to anything.
const E2E_MODE = process.env.NEXT_PUBLIC_E2E === "1";

export function LiffProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>("loading");
  const [error, setError] = useState<string | null>(null);
  const token = useRef<string | null>(null);
  const inflight = useRef<Promise<string> | null>(null);
  // Follow the device's light/dark preference (tokens define a `.dark` class).
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => document.documentElement.classList.toggle("dark", media.matches);
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, []);

  const authenticate = useCallback(async (): Promise<string> => {
    if (inflight.current) return inflight.current;
    const run = (async () => {
      if (E2E_MODE) {
        // lets a test hold the opening screen (set with addInitScript; unused otherwise)
        const hold = (window as { __E2E_AUTH_DELAY_MS?: number }).__E2E_AUTH_DELAY_MS;
        if (hold) await new Promise((r) => setTimeout(r, hold));
        token.current = "e2e-token";
        return token.current;
      }
      if (!LIFF_ID) throw new Error(t("ยังไม่ได้ตั้งค่า LIFF"));
      const liff = (await import("@line/liff")).default;
      await liff.init({ liffId: LIFF_ID });
      if (!liff.isLoggedIn()) return loginOnce(liff);
      const idToken = liff.getIDToken();
      if (!idToken) return loginOnce(liff);
      const res = await fetch("/api/auth/liff", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idToken }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        token?: string;
        error?: string;
        tz?: string | null;
        cur?: string | null;
        loc?: string | null;
      };
      if (!res.ok || !body.token) {
        // An expired ID token needs a fresh login rather than a retry.
        if (res.status === 401) return loginOnce(liff);
        throw new Error(body.error ?? t("เข้าสู่ระบบไม่สำเร็จ"));
      }
      token.current = body.token;
      // dates on every page are shown and read in the person's zone
      const zone = body.tz;
      if (isZone(zone)) setZoneSource(() => zone);
      // and amounts in their currency
      const cur = body.cur;
      if (isHomeCurrency(cur)) setCurrencySource(() => cur);
      // and words in their language: a page loaded in another reloads once in theirs
      const loc = body.loc;
      if (isLocale(loc)) {
        setLocaleSource(() => loc);
        if (loc !== (isLocale(startLocale) ? startLocale : "th")) switchLocale(loc);
      }
      try {
        window.sessionStorage.removeItem(RELOGIN_KEY);
      } catch {
        // ignore
      }
      return body.token;
    })();
    inflight.current = run;
    try {
      return await run;
    } finally {
      inflight.current = null;
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    authenticate()
      .then(() => {
        if (!cancelled) setStatus("ready");
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : t("เข้าสู่ระบบไม่สำเร็จ"));
        setStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, [authenticate]);

  const api = useCallback(
    async <T,>(path: string, init: RequestInit = {}): Promise<T> => {
      const call = async (bearer: string) => {
        const headers = new Headers(init.headers);
        headers.set("Authorization", `Bearer ${bearer}`);
        if (init.body && !(init.body instanceof FormData) && !headers.has("Content-Type")) {
          headers.set("Content-Type", "application/json");
        }
        return fetch(path, { ...init, headers });
      };

      let res = await call(token.current ?? (await authenticate()));
      if (res.status === 401) {
        token.current = null;
        res = await call(await authenticate());
      }
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok)
        throw new ApiError(body.error ?? t("เกิดข้อผิดพลาด ลองใหม่อีกครั้งนะ"), res.status);
      return body as T;
    },
    [authenticate],
  );

  const openExternal = useCallback(async (url: string) => {
    try {
      const liff = (await import("@line/liff")).default;
      if (liff.isInClient()) {
        liff.openWindow({ url, external: true });
        return;
      }
    } catch {
      // fall through to a normal window
    }
    window.open(url, "_blank", "noopener");
  }, []);

  const value = useMemo(
    () => ({
      status,
      error,
      api,
      openExternal,
    }),
    [status, error, api, openExternal],
  );
  return (
    <LiffContext.Provider value={value}>
      {status === "loading" ? <Splash /> : children}
    </LiffContext.Provider>
  );
}

export function useLiff(): LiffContextValue {
  const ctx = useContext(LiffContext);
  if (!ctx) throw new Error("useLiff must be used inside <LiffProvider>");
  return ctx;
}

interface ApiState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  reload: () => void;
}

/** GET `path` once the session is ready; refetches when `path` changes or reload() is called. */
export function useApi<T>(path: string | null): ApiState<T> {
  const { status, api, error: authError } = useLiff();
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (status === "error") {
      setError(authError ?? t("เข้าสู่ระบบไม่สำเร็จ"));
      setLoading(false);
      return;
    }
    if (path === null) {
      // nothing to fetch (e.g. a locked section): not loading, no data
      setData(null);
      setLoading(false);
      return;
    }
    if (status !== "ready") return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    api<T>(path)
      .then((d) => !cancelled && setData(d))
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : t("เกิดข้อผิดพลาด"));
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [status, api, path, tick, authError]);

  const reload = useCallback(() => setTick((n) => n + 1), []);
  return { data, error, loading, reload };
}
