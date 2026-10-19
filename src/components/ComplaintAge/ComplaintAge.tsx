"use client";

import { complaintAgeMs, complaintAgeTone } from "@/lib/complaintAge";
import { cx } from "@/lib/cx";
import { formatAge } from "@/lib/format";
import { useNow } from "@/lib/useNow";
import styles from "./ComplaintAge.module.css";

type Props = {
  raisedAt: string; // ISO timestamp, the only thing stored
  asOf: string; // ISO timestamp of the server render, so hydration matches
  className?: string;
};

const TONE = {
  neutral: styles.neutral,
  amber: styles.amber,
  red: styles.red,
} as const;

export function ComplaintAge({ raisedAt, asOf, className }: Props) {
  // Minute granularity: the age text only changes by the hour or the minute.
  const ageMs = complaintAgeMs(raisedAt, useNow(asOf, 60_000));

  return <span className={cx(styles.age, TONE[complaintAgeTone(ageMs)], className)}>{formatAge(ageMs)}</span>;
}
