import type { ReactNode } from "react";
import { Avatar } from "@/components/Avatar/Avatar";
import { cx } from "@/lib/cx";
import styles from "./PersonCell.module.css";

type Props = {
  name: string;
  sub?: ReactNode;
  size?: 32 | 36 | "responsive"; // passed straight through to Avatar
  // A caller's className can set custom properties on this element:
  //   --person-gap          avatar-to-text gap (default 12px)
  //   --person-sub-display  "none" hides the sub line at a breakpoint
  //   --person-name-size / --person-sub-size  text sizes (default 14px, and
  //                         12px / 11px on mobile)
  //   --avatar-size / --avatar-font  when size="responsive"
  className?: string;
};

export function PersonCell({ name, sub, size = 36, className }: Props) {
  return (
    <div className={cx(styles.person, className)}>
      <Avatar name={name} size={size} />
      <div className={styles.text}>
        <span className={styles.name}>{name}</span>
        {sub ? <span className={styles.sub}>{sub}</span> : null}
      </div>
    </div>
  );
}
