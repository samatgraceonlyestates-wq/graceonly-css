import type { ReactNode } from "react";
import { Card } from "@/components/Card/Card";
import { cx } from "@/lib/cx";
import type { Direction } from "@/lib/sampleData";
import styles from "./StatTile.module.css";

type Tone = "burgundy" | "green" | "amber" | "red";

type Props = {
  label: string;
  shortLabel?: string; // used on mobile when the full label is too long
  value: ReactNode; // a number, or a live readout such as <Duration />
  caption?: ReactNode; // shown on mobile too, except on dense tiles
  dot?: boolean; // a dot in the tone colour beside the number, desktop only
  tone?: Tone;
  delta?: { direction: Direction; text: string };
  comparison?: string; // "vs yesterday", hidden on mobile like the design
  dense?: boolean; // tighter padding and smaller number (attendance register)
  desktopOnly?: boolean;
};

const TONE = {
  burgundy: undefined,
  green: styles.green,
  amber: styles.amber,
  red: styles.red,
} as const;

const DOT = {
  burgundy: styles.dotBurgundy,
  green: styles.dotGreen,
  amber: styles.dotAmber,
  red: styles.dotRed,
} as const;

export function StatTile({
  label,
  shortLabel,
  value,
  tone = "burgundy",
  delta,
  comparison,
  caption,
  dot = false,
  dense = false,
  desktopOnly = false,
}: Props) {
  return (
    <Card
      padding="none"
      className={cx(styles.tile, dense && styles.dense, desktopOnly && styles.desktopOnly)}
    >
      <p className={styles.label}>
        {shortLabel ? (
          <>
            <span className={styles.fullLabel}>{label}</span>
            <span className={styles.shortLabel}>{shortLabel}</span>
          </>
        ) : (
          label
        )}
      </p>
      <div className={styles.valueRow}>
        <p className={cx(styles.value, TONE[tone])}>{value}</p>
        {dot ? <span className={cx(styles.dot, DOT[tone])} aria-hidden="true" /> : null}
      </div>
      {delta ? (
        <p className={styles.delta}>
          <span className={styles.deltaValue}>
            <span className={styles.arrow} aria-hidden="true">
              {delta.direction === "up" ? "↗" : "↘"}
            </span>
            {delta.text}
          </span>
          {comparison ? <span className={styles.comparison}>{comparison}</span> : null}
        </p>
      ) : null}
      {caption ? <p className={styles.caption}>{caption}</p> : null}
    </Card>
  );
}
