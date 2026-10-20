"use client";

import { complaintAgeMs, complaintAgeTone } from "@/lib/complaintAge";
import { cx } from "@/lib/cx";
import { formatAge } from "@/lib/format";
import { useNow } from "@/lib/useNow";
import styles from "./ComplaintAge.module.css";

// Size is the caller's: set font-size through className. Weight is a variable,
// --complaint-age-weight (default 600), set the same way.
type Props = {
  raisedAt: string; // ISO timestamp, the only thing stored
  asOf: string; // ISO timestamp of the server render, so hydration matches
  // A resolved case: its age freezes here (resolvedAt) instead of counting
  // forever, and it is neutral, since a time-to-resolve is a measurement, not
  // an alarm.
  until?: string;
  className?: string;
};

const TONE = {
  neutral: styles.neutral,
  amber: styles.amber,
  red: styles.red,
} as const;

export function ComplaintAge({ raisedAt, asOf, until, className }: Props) {
  // Minute granularity: the age text only changes by the hour or the minute.
  const nowMs = useNow(asOf, 60_000);
  const ageMs = complaintAgeMs(raisedAt, until ? Date.parse(until) : nowMs);
  const tone = until ? "neutral" : complaintAgeTone(ageMs);

  return <span className={cx(styles.age, TONE[tone], className)}>{formatAge(ageMs)}</span>;
}
