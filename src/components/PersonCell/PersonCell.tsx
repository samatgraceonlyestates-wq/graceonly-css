import type { ReactNode } from "react";
import { Avatar } from "@/components/Avatar/Avatar";
import { cx } from "@/lib/cx";
import styles from "./PersonCell.module.css";

type Props = {
  name: string;
  sub?: ReactNode;
  // The avatar-to-text gap defaults to 12px; a caller can set --person-gap.
  className?: string;
};

export function PersonCell({ name, sub, className }: Props) {
  return (
    <div className={cx(styles.person, className)}>
      <Avatar name={name} />
      <div className={styles.text}>
        <span className={styles.name}>{name}</span>
        {sub ? <span className={styles.sub}>{sub}</span> : null}
      </div>
    </div>
  );
}
