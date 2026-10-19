import type { ReactNode } from "react";
import { cx } from "@/lib/cx";
import styles from "./Chip.module.css";

export function Chip({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cx(styles.chip, className)}>{children}</span>;
}
