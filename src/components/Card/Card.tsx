import type { ReactNode } from "react";
import { cx } from "@/lib/cx";
import styles from "./Card.module.css";

type Props = {
  as?: "div" | "section" | "article" | "aside";
  // md 24px, lg 32px, table 20/24/24, none for callers that set their own.
  padding?: "none" | "md" | "lg" | "table";
  // Drops the white surface on mobile so children can be their own cards.
  plainOnMobile?: boolean;
  className?: string;
  "aria-labelledby"?: string;
  children: ReactNode;
};

const PADDING = {
  none: undefined,
  md: styles.padMd,
  lg: styles.padLg,
  table: styles.padTable,
} as const;

export function Card({
  as: Tag = "div",
  padding = "md",
  plainOnMobile = false,
  className,
  children,
  ...rest
}: Props) {
  return (
    <Tag
      className={cx(styles.card, PADDING[padding], plainOnMobile && styles.plainOnMobile, className)}
      {...rest}
    >
      {children}
    </Tag>
  );
}
