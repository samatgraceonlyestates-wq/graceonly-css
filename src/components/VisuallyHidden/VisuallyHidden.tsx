import type { ReactNode } from "react";
import styles from "./VisuallyHidden.module.css";

// Text for screen readers only, e.g. the name of an icon-only or empty column.
export function VisuallyHidden({ children }: { children: ReactNode }) {
  return <span className={styles.hidden}>{children}</span>;
}
