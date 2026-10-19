import type { ComponentPropsWithoutRef, CSSProperties } from "react";
import { cx } from "@/lib/cx";
import styles from "./Table.module.css";

// Primitives for the visit log (03) and attendance register (08). Put the table
// inside <Card padding="table">. Not used yet; mobile layout is decided with
// those screens.

export function Table({ className, ...rest }: ComponentPropsWithoutRef<"table">) {
  return <table className={cx(styles.table, className)} {...rest} />;
}

export function TableHead(props: ComponentPropsWithoutRef<"thead">) {
  return <thead {...props} />;
}

export function TableBody(props: ComponentPropsWithoutRef<"tbody">) {
  return <tbody {...props} />;
}

export function TableRow({ className, ...rest }: ComponentPropsWithoutRef<"tr">) {
  return <tr className={cx(styles.row, className)} {...rest} />;
}

type HeaderCellProps = ComponentPropsWithoutRef<"th"> & { width?: CSSProperties["width"] };

export function TableHeaderCell({ width, className, style, ...rest }: HeaderCellProps) {
  // width is a per-column value, so it is genuinely dynamic.
  return <th scope="col" className={cx(styles.th, className)} style={{ width, ...style }} {...rest} />;
}

export function TableCell({ className, ...rest }: ComponentPropsWithoutRef<"td">) {
  return <td className={cx(styles.td, className)} {...rest} />;
}
