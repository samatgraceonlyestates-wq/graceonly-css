import type { ReactNode } from "react";
import { cx } from "@/lib/cx";
import styles from "./Notice.module.css";

// A card with a 4px rail down the left. The rail is a fill; the text stays
// dusk and burgundy. Tones: info (steel), guidance (silver, "keep typing"),
// limited (amber, "try again" or "not available"), failure (red, "something is
// wrong"). Use role="alert" only for a failure the person must notice at once,
// role="status" for the rest.
type Props = {
  tone: "info" | "guidance" | "limited" | "failure";
  title?: string;
  role?: "status" | "alert";
  className?: string;
  children: ReactNode;
};

const TONE = {
  info: styles.info,
  guidance: styles.guidance,
  limited: styles.limited,
  failure: styles.failure,
} as const;

export function Notice({ tone, title, role, className, children }: Props) {
  return (
    <div className={cx(styles.notice, TONE[tone], className)} role={role}>
      {title ? <p className={styles.title}>{title}</p> : null}
      <div className={styles.text}>{children}</div>
    </div>
  );
}
