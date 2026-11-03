"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { Splash } from "@/components/liff/splash";

/**
 * LIFF entry point (the LIFF Endpoint URL is the site root).
 *
 * `liff.line.me/<id>/budgets` opens `/?liff.state=%2Fbudgets`, and only `liff.init()` turns that
 * into the real page. So this page must initialise LIFF, then go to the deep link (or /summary
 * when there is none). A plain server redirect would drop the query string.
 */
export default function HomePage() {
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const liffId = process.env.NEXT_PUBLIC_LIFF_ID;
      const state = new URLSearchParams(window.location.search).get("liff.state");

      if (liffId) {
        try {
          const liff = (await import("@line/liff")).default;
          await liff.init({ liffId });
        } catch {
          // Not fatal: fall through to the manual redirect below.
        }
      }
      if (cancelled) return;

      // The SDK may already have rewritten the URL (without a navigation). Go there in this same page:
      // reloading it loses that it was opened from a chat, and LINE then refuses liff.sendMessages.
      const { pathname, search } = window.location;
      if (pathname !== "/") {
        router.replace(`${pathname}${search}`);
        return;
      }

      // Same-origin relative deep link only (guards against open redirects).
      if (state && state.startsWith("/") && !state.startsWith("//")) {
        router.replace(state);
        return;
      }
      router.replace("/summary");
    })();

    return () => {
      cancelled = true;
    };
  }, [router]);

  // the same opening screen as the pages behind it (logo video), so nothing else flashes first
  return <Splash />;
}
