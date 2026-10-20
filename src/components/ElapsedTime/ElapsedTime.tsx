"use client";

import { elapsedSeconds, elapsedTone, formatElapsed } from "@/lib/elapsed";
import { cx } from "@/lib/cx";
import { useNow } from "@/lib/useNow";
import styles from "./ElapsedTime.module.css";

type Props = {
  checkInAt: string; // ISO timestamp, the only thing stored
  asOf: string; // ISO timestamp of the server render, so hydration matches
  // Size it from a two-class selector (`.parent .x`) so it wins over the 14px here.
  className?: string;
};

const TONE = {
  green: styles.green,
  amber: styles.amber,
  red: styles.red,
} as const;

export function ElapsedTime({ checkInAt, asOf, className }: Props) {
  const seconds = elapsedSeconds(checkInAt, useNow(asOf));

  return (
    <span className={cx(styles.time, TONE[elapsedTone(seconds)], className)} role="timer">
      {formatElapsed(seconds)}
    </span>
  );
}
