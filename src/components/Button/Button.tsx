import Link from "next/link";
import type { ReactNode } from "react";
import { cx } from "@/lib/cx";
import styles from "./Button.module.css";

// Two variants. primary: burgundy fill, sizes default (14px text, 24/14
// padding) and compact (13px text, 20/12 padding). row-action: white fill,
// 1.5px steel border, 12px text, 32px tall; it has a single size.
// The login submit keeps its own 16px style (see CLAUDE.md).
type Props = {
  variant?: "primary" | "row-action";
  size?: "default" | "compact"; // primary only
  href?: string;
  type?: "button" | "submit";
  className?: string;
  children: ReactNode;
};

export function Button({
  variant = "primary",
  size = "default",
  href,
  type = "button",
  className,
  children,
}: Props) {
  const classes = cx(
    styles.button,
    variant === "row-action"
      ? styles.rowAction
      : cx(styles.primary, size === "compact" ? styles.compact : styles.default),
    className,
  );

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
