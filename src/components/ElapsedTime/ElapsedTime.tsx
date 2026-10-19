"use client";

import { elapsedSeconds, elapsedTone, formatElapsed } from "@/lib/elapsed";
import { useNow } from "@/lib/useNow";
import styles from "./ElapsedTime.module.css";

type Props = {
  checkInAt: string; // ISO timestamp, the only thing stored
  asOf: string; // ISO timestamp of the server render, so hydration matches
};

const TONE = {
  green: styles.green,
  amber: styles.amber,
  red: styles.red,
} as const;

export function ElapsedTime({ checkInAt, asOf }: Props) {
  const seconds = elapsedSeconds(checkInAt, useNow(asOf));

  return (
    <span className={`${styles.time} ${TONE[elapsedTone(seconds)]}`} role="timer">
      {formatElapsed(seconds)}
    </span>
  );
}
