import type { ReactNode } from "react";
import { cx } from "@/lib/cx";
import styles from "./StatusPill.module.css";

// Tint fill, status-coloured dot, --fold-dusk label. The label is deliberately
// NOT the status colour: Figma sets it equal to the fill, which is invisible.
type Props = {
  tone: "green" | "amber" | "red" | "steel";
  children: ReactNode;
  className?: string;
};

const TONE = {
  green: styles.green,
  amber: styles.amber,
  red: styles.red,
  steel: styles.steel,
} as const;

export function StatusPill({ tone, children, className }: Props) {
  return (
    <span className={cx(styles.pill, TONE[tone], className)}>
      <span className={styles.dot} aria-hidden="true" />
      {children}
    </span>
  );
}
