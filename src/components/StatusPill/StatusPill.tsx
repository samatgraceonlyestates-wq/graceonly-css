import type { ReactNode } from "react";
import { VisuallyHidden } from "@/components/VisuallyHidden/VisuallyHidden";
import { cx } from "@/lib/cx";
import styles from "./StatusPill.module.css";

// Tint fill, status-coloured dot, --fold-dusk label. The label is deliberately
// NOT the status colour: Figma sets it equal to the fill, which is invisible.
type Props = {
  // neutral (silver) is for "nothing to report yet", e.g. not clocked in.
  tone: "green" | "amber" | "red" | "steel" | "neutral";
  // large: the shift pill on the clock card (11px text, 8px dot, 12/6 padding).
  size?: "default" | "large";
  // Only the dot, for a tight row on mobile. The label stays for screen readers.
  dotOnly?: boolean;
  // Below 768px: drop the dot and shrink to 9px text, for short labels
  // ("OK", "LEAVE") in a mobile card (Figma 32:168). The caller supplies the
  // short label itself.
  compactOnMobile?: boolean;
  children: ReactNode;
  className?: string;
};

const TONE = {
  green: styles.green,
  amber: styles.amber,
  red: styles.red,
  steel: styles.steel,
  neutral: styles.neutral,
} as const;

export function StatusPill({
  tone,
  size = "default",
  dotOnly = false,
  compactOnMobile = false,
  children,
  className,
}: Props) {
  return (
    <span
      className={cx(
        styles.pill,
        TONE[tone],
        size === "large" && styles.large,
        dotOnly && styles.dotOnly,
        compactOnMobile && styles.compactOnMobile,
        className,
      )}
    >
      <span className={styles.dot} aria-hidden="true" />
      {dotOnly ? <VisuallyHidden>{children}</VisuallyHidden> : children}
    </span>
  );
}
