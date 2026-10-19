import type { ReactNode } from "react";
import { cx } from "@/lib/cx";
import styles from "./PageHeader.module.css";

type Props = {
  eyebrow: ReactNode;
  title: ReactNode;
  lede?: ReactNode;
  ledeHiddenOnMobile?: boolean;
  actions?: ReactNode;
};

export function PageHeader({ eyebrow, title, lede, ledeHiddenOnMobile = false, actions }: Props) {
  return (
    <header className={styles.header}>
      <div className={styles.text}>
        <p className={styles.eyebrow}>{eyebrow}</p>
        <h1 className={styles.title}>{title}</h1>
        {lede ? (
          <p className={cx(styles.lede, ledeHiddenOnMobile && styles.ledeHiddenOnMobile)}>{lede}</p>
        ) : null}
      </div>
      {actions ? <div className={styles.actions}>{actions}</div> : null}
    </header>
  );
}
