"use client";

import { useEffect, useState } from "react";
import { elapsedSeconds, elapsedTone, formatElapsed } from "@/lib/elapsed";
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
  const [nowMs, setNowMs] = useState(() => Date.parse(asOf));

  useEffect(() => {
    // TODO: this uses the browser clock, which can be wrong. The server should
    // send its own "now" so the client can correct for drift (asOf is already
    // server time: offset = Date.now() - Date.parse(asOf) at mount).
    const id = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const seconds = elapsedSeconds(checkInAt, nowMs);

  return (
    <span className={`${styles.time} ${TONE[elapsedTone(seconds)]}`} role="timer">
      {formatElapsed(seconds)}
    </span>
  );
}
