"use client";

import { getClockParts } from "@/lib/format";
import { useNow } from "@/lib/useNow";

type Props = {
  asOf: string; // ISO timestamp of the server render, so hydration matches
  // "time": "10:42 AM". "date": "Friday, 16 October 2026".
  part: "time" | "date";
  className?: string;
};

// The big clock. It reads the shared useNow interval (minute granularity, as
// no seconds are shown), so it adds no timer of its own.
export function LiveClock({ asOf, part, className }: Props) {
  const clock = getClockParts(new Date(useNow(asOf, 60_000)));
  const text = part === "time" ? clock.time12 : `${clock.weekdayLong}, ${clock.day} ${clock.monthLong} ${clock.year}`;

  return <span className={className}>{text}</span>;
}
