"use client";

import { cx } from "@/lib/cx";
import { formatDuration } from "@/lib/format";
import { useNow } from "@/lib/useNow";
import styles from "./Duration.module.css";

type Props = {
  since: string; // ISO timestamp, e.g. a clock-in; the only thing stored
  asOf: string; // ISO timestamp of the server render, so hydration matches
  className?: string;
};

// "1h 55m", counted from `since` and ticking on the shared interval. Minute
// granularity: the text only changes once a minute.
export function Duration({ since, asOf, className }: Props) {
  const ms = useNow(asOf, 60_000) - Date.parse(since);

  return <span className={cx(styles.duration, className)}>{formatDuration(ms)}</span>;
}
