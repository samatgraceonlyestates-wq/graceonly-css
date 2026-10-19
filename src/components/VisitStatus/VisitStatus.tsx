"use client";

import { StatusPill } from "@/components/StatusPill/StatusPill";
import { elapsedSeconds, elapsedTone } from "@/lib/elapsed";
import { useNow } from "@/lib/useNow";

type Props = {
  checkInAt: string; // ISO timestamp
  asOf: string; // ISO timestamp of the server render
  className?: string;
};

// Same thresholds as ElapsedTime, so the pill and the timer always agree:
// on track under 10 minutes, long 10 to 30, overdue over 30.
const STATUS = {
  green: { tone: "green", label: "On track" },
  amber: { tone: "amber", label: "Long" },
  red: { tone: "red", label: "Overdue" },
} as const;

export function VisitStatus({ checkInAt, asOf, className }: Props) {
  const { tone, label } = STATUS[elapsedTone(elapsedSeconds(checkInAt, useNow(asOf)))];

  return (
    <StatusPill tone={tone} className={className}>
      {label}
    </StatusPill>
  );
}
