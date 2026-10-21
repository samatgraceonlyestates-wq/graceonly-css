"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { refreshDue } from "@/lib/refreshDue";
import { useNow } from "@/lib/useNow";

// The board's LIVE REFRESH: with two front-desk people, one must see the other's work.
//
// ONE shared poll, and NO timer of its own: it rides the existing shared clock
// (useNow.ts, the only ticking interval on the page) at a 30-second grain and asks
// refreshDue() on each beat. It does nothing while the tab is hidden (she will leave it
// open all day on a machine that is doing other things), and coming back to a hidden tab
// refreshes at once. router.refresh() re-reads the server components and leaves the
// client state alone, so a panel she has open and the text in it survive a refresh; the
// correction panel keeps the VERSION it was opened with, so a record someone changed
// under her is refused cleanly, not overwritten.
const EVERY_MS = 30_000;

export function BoardRefresher({ asOf }: { asOf: string }) {
  const router = useRouter();
  const now = useNow(asOf, EVERY_MS);
  const lastRefreshAt = useRef(Date.parse(asOf));

  // A fresh render from the server is a refresh as far as this is concerned.
  useEffect(() => {
    lastRefreshAt.current = Date.parse(asOf);
  }, [asOf]);

  useEffect(() => {
    if (refreshDue({ now, lastRefreshAt: lastRefreshAt.current, everyMs: EVERY_MS, visible: document.visibilityState === "visible" })) {
      lastRefreshAt.current = now;
      router.refresh();
    }
  }, [now, router]);

  // Back to a tab that was hidden: catch up at once. (An event, not a timer.)
  useEffect(() => {
    const onVisible = () => {
      const at = Date.now();
      if (refreshDue({ now: at, lastRefreshAt: lastRefreshAt.current, everyMs: EVERY_MS, visible: document.visibilityState === "visible" })) {
        lastRefreshAt.current = at;
        router.refresh();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [router]);

  return null;
}
