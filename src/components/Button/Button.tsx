import Link from "next/link";
import type { ReactNode } from "react";
import { cx } from "@/lib/cx";
import styles from "./Button.module.css";

// Two variants. primary: burgundy fill, sizes default (14px text, 24/14
// padding), compact (13px text, 20/12 padding) and large (the clock in / out
// action: 18px text, 20/36 padding; on mobile 15px, 16/24 and full width).
// row-action: white fill, 1.5px steel border, 12px text, 32px tall; it has a
// single size. The login submit keeps its own 16px style (see CLAUDE.md).
type Props = {
  variant?: "primary" | "row-action";
  size?: "default" | "compact" | "large"; // primary only
  href?: string;
  type?: "button" | "submit";
  className?: string;
  children: ReactNode;
};

const SIZE = { default: styles.default, compact: styles.compact, large: styles.large } as const;

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
      : cx(styles.primary, SIZE[size]),
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
