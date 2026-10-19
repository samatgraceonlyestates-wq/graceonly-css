import { useSyncExternalStore } from "react";

// ONE interval for the whole page, shared by every consumer (ElapsedTime,
// ComplaintAge, VisitStatus). It starts with the first subscriber and stops
// with the last, so an all-day dashboard runs a single timer.
//
// TODO: this uses the browser clock, which can be wrong. The server should
// send its own "now" so the client can correct for drift. `asOf` is already
// server time: offset = Date.now() - Date.parse(asOf) at mount.

const TICK_MS = 1000;

const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | undefined;
let lastNow = 0; // 0 means "not read yet"; reset when the last consumer leaves

function readNow(): number {
  if (lastNow === 0) lastNow = Date.now();
  return lastNow;
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  if (timer === undefined) {
    lastNow = Date.now();
    timer = setInterval(() => {
      lastNow = Date.now();
      listeners.forEach((listener) => listener());
    }, TICK_MS);
  }
  return () => {
    listeners.delete(onChange);
    if (listeners.size === 0 && timer !== undefined) {
      clearInterval(timer);
      timer = undefined;
      lastNow = 0;
    }
  };
}

const floorTo = (ms: number, step: number) => Math.floor(ms / step) * step;

// `asOf` is the server render time, so hydration matches the server HTML.
// `granularityMs` lets slow consumers (a minute-level age) skip re-renders:
// React only re-renders when the floored value changes.
export function useNow(asOf: string, granularityMs = 1000): number {
  const serverNow = floorTo(Date.parse(asOf), granularityMs);
  return useSyncExternalStore(
    subscribe,
    () => floorTo(readNow(), granularityMs),
    () => serverNow,
  );
}
