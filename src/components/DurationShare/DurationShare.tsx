"use client";

import { useNow } from "@/lib/useNow";

type Props = {
  since: string; // ISO timestamp of the open shift
  asOf: string; // ISO timestamp of the server render
  plusMs: number; // time already banked before `since`
  targetMs: number;
};

// "69%": the running total (plusMs + now - since) as a share of the target,
// ticking on the shared interval with the Duration beside it.
export function DurationShare({ since, asOf, plusMs, targetMs }: Props) {
  const ms = useNow(asOf, 60_000) - Date.parse(since) + plusMs;

  return <>{Math.round((ms / targetMs) * 100)}%</>;
}
