import Link from "next/link";
import type { ReactNode } from "react";
import { cx } from "@/lib/cx";
import styles from "./Button.module.css";

// Primary button. Sizes: default 14px text, 24/14 padding; compact 13px text,
// 20/12 padding. The login submit keeps its own 16px style (see CLAUDE.md).
// TODO: row-action variant, when screens 03 and 06 are built.
type Props = {
  size?: "default" | "compact";
  href?: string;
  type?: "button" | "submit";
  className?: string;
  children: ReactNode;
};

export function Button({ size = "default", href, type = "button", className, children }: Props) {
  const classes = cx(styles.button, size === "compact" ? styles.compact : styles.default, className);

  if (href) {
    return (
      <Link href={href} className={classes}>
        {children}
      </Link>
    );
  }

  return (
    <button type={type} className={classes}>
      {children}
    </button>
  );
}
