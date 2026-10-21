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
// client state alone; the correction panels keep the VERSION of the record they were opened
// with, so a record someone changed under her is refused cleanly, not overwritten.
//
// A REFRESH MUST NEVER TAKE AWAY WHAT SHE IS TYPING. A refresh can move a row to another
// group (someone else clocked the person out), which would unmount the panel under her and
// lose what she had typed, and the stale-write protection does not help her retype it. So it
// is PAUSED while any panel is open (anything marked data-pause-refresh) or any field in the
// page has focus; it is paused, not dropped: the moment she is done (a field loses focus, or
// a click closes the panel) the refresh that was waiting runs.
const EVERY_MS = 30_000;

/** Is she in the middle of something? A panel is open, or a field has focus. */
function userIsBusy(): boolean {
  if (document.querySelector("[data-pause-refresh]") !== null) return true;
  const active = document.activeElement;
  if (!(active instanceof HTMLElement)) return false;
  return active.tagName === "INPUT" || active.tagName === "TEXTAREA" || active.tagName === "SELECT" || active.isContentEditable;
}

export function BoardRefresher({ asOf }: { asOf: string }) {
  const router = useRouter();
  const now = useNow(asOf, EVERY_MS);
  const lastRefreshAt = useRef(Date.parse(asOf));
  // A refresh was due while she was busy; it runs as soon as she is done.
  const waiting = useRef(false);

  // A fresh render from the server is a refresh as far as this is concerned.
  useEffect(() => {
    lastRefreshAt.current = Date.parse(asOf);
  }, [asOf]);

  useEffect(() => {
    const visible = document.visibilityState === "visible";
    if (!refreshDue({ now, lastRefreshAt: lastRefreshAt.current, everyMs: EVERY_MS, visible })) return;
    if (userIsBusy()) {
      waiting.current = true; // paused, not dropped
      return;
    }
    waiting.current = false;
    lastRefreshAt.current = now;
    router.refresh();
  }, [now, router]);

  // She is done (a field lost focus, or a click closed a panel): run the refresh that was
  // waiting. Events, not timers; the check waits one frame so the page has settled after the click.
  useEffect(() => {
    const resume = () => {
      if (!waiting.current) return;
      window.requestAnimationFrame(() => {
        if (!waiting.current || userIsBusy() || document.visibilityState !== "visible") return;
        waiting.current = false;
        lastRefreshAt.current = Date.now();
        router.refresh();
      });
    };
    document.addEventListener("focusout", resume);
    document.addEventListener("click", resume);
    return () => {
      document.removeEventListener("focusout", resume);
      document.removeEventListener("click", resume);
    };
  }, [router]);

  // Back to a tab that was hidden: catch up at once. (An event, not a timer.)
  useEffect(() => {
    const onVisible = () => {
      const at = Date.now();
      if (!refreshDue({ now: at, lastRefreshAt: lastRefreshAt.current, everyMs: EVERY_MS, visible: document.visibilityState === "visible" })) return;
      if (userIsBusy()) {
        waiting.current = true;
        return;
      }
      lastRefreshAt.current = at;
      router.refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [router]);

  return null;
}
