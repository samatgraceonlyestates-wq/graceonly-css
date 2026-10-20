import type { ReactNode } from "react";
import { cx } from "@/lib/cx";
import styles from "./PageHeader.module.css";

// A caller's className can set custom properties on the header:
//   --page-header-eyebrow-gap  space under the eyebrow (6px mobile, 10px desktop)
//   --page-header-lede-gap     space above the lede (6px mobile, 10px desktop)
type Props = {
  eyebrow: ReactNode;
  title: ReactNode;
  lede?: ReactNode;
  // "sm": 12px on mobile, 15px on desktop, no tracking (attendance register).
  ledeSize?: "default" | "sm";
  ledeHiddenOnMobile?: boolean;
  // Mobile: stacked under the text. Desktop: right-aligned on the title baseline.
  actions?: ReactNode;
  className?: string;
};

export function PageHeader({
  eyebrow,
  title,
  lede,
  ledeSize = "default",
  ledeHiddenOnMobile = false,
  actions,
  className,
}: Props) {
  return (
    <header className={cx(styles.header, className)}>
      <div className={styles.text}>
        <p className={styles.eyebrow}>{eyebrow}</p>
        <h1 className={styles.title}>{title}</h1>
        {lede ? (
          <p
            className={cx(
              styles.lede,
              ledeSize === "sm" && styles.ledeSm,
              ledeHiddenOnMobile && styles.ledeHiddenOnMobile,
            )}
          >
            {lede}
          </p>
        ) : null}
      </div>
      {actions ? <div className={styles.actions}>{actions}</div> : null}
    </header>
  );
}
