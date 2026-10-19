"use client";

import { useEffect, useState } from "react";
import { complaintAgeMs, complaintAgeTone } from "@/lib/complaintAge";
import { cx } from "@/lib/cx";
import { formatAge } from "@/lib/format";
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
  const [nowMs, setNowMs] = useState(() => Date.parse(asOf));

  useEffect(() => {
    // TODO: this uses the browser clock, which can be wrong. The server should
    // send its own "now" so the client can correct for drift (asOf is already
    // server time: offset = Date.now() - Date.parse(asOf) at mount).
    const id = window.setInterval(() => setNowMs(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  const ageMs = complaintAgeMs(raisedAt, nowMs);

  return (
    <span className={cx(styles.age, TONE[complaintAgeTone(ageMs)], className)}>{formatAge(ageMs)}</span>
  );
}
