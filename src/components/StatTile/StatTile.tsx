import { Card } from "@/components/Card/Card";
import { cx } from "@/lib/cx";
import type { Direction } from "@/lib/sampleData";
import styles from "./StatTile.module.css";

type Props = {
  label: string;
  shortLabel?: string; // used on mobile when the full label is too long
  value: number | string;
  tone?: "burgundy" | "green" | "amber" | "red";
  delta?: { direction: Direction; text: string };
  comparison?: string; // "vs yesterday", hidden on mobile like the design
  caption?: string;
  desktopOnly?: boolean;
};

const TONE = {
  burgundy: undefined,
  green: styles.green,
  amber: styles.amber,
  red: styles.red,
} as const;

export function StatTile({
  label,
  shortLabel,
  value,
  tone = "burgundy",
  delta,
  comparison,
  caption,
  desktopOnly = false,
}: Props) {
  return (
    <Card padding="none" className={cx(styles.tile, desktopOnly && styles.desktopOnly)}>
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
      <p className={cx(styles.value, TONE[tone])}>{value}</p>
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
