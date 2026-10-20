import type { ComponentPropsWithoutRef, CSSProperties } from "react";
import { cx } from "@/lib/cx";
import styles from "./Table.module.css";

// Table primitives for the visit log (03) and attendance register (08). Put the
// table inside <Card padding="table" plainOnMobile>.
//
// Below 768px a table has exactly TWO mobile layouts, chosen by `mobileLayout`;
// there is no horizontal scroll in either:
//   "cards" (default): a stack of cards (03 and 08). See below.
//   "rules": ruled rows inside one surrounding card (07's week list). Each row
//            is a single block; the screen lays out what is inside it.
// If a THIRD mobile layout is ever needed, stop: the primitive is wrong, not
// short of another flag.
//
// In "cards" mode the primitives supply the card chrome and hide the header
// row; the SCREEN decides the layout of each card:
//   - give TableRow a className that sets grid-template-columns/areas,
//   - give TableCell a className that sets grid-area,
//   - mark cells that do not appear on mobile with hideOnMobile.
// Card padding and gaps come from --table-card-pad-x, --table-card-pad-y,
// --table-card-gap (between cards) and --table-card-col-gap (between cells in a
// card); defaults 16, 14, 10 and 12, so a denser screen can override them.
// --table-cell-min-height (default 40px, Figma's person cell) sets the minimum
// content height of a desktop row; a screen without avatars lowers it.
// Explicit roles keep table semantics when the elements stop being display:table.

type TableProps = ComponentPropsWithoutRef<"table"> & { mobileLayout?: "cards" | "rules" };

export function Table({ mobileLayout = "cards", className, ...rest }: TableProps) {
  return (
    <table
      role="table"
      className={cx(styles.table, mobileLayout === "rules" && styles.rules, className)}
      {...rest}
    />
  );
}

export function TableHead({ className, ...rest }: ComponentPropsWithoutRef<"thead">) {
  return <thead role="rowgroup" className={cx(styles.thead, className)} {...rest} />;
}

export function TableBody({ className, ...rest }: ComponentPropsWithoutRef<"tbody">) {
  return <tbody role="rowgroup" className={cx(styles.tbody, className)} {...rest} />;
}

export function TableRow({ className, ...rest }: ComponentPropsWithoutRef<"tr">) {
  return <tr role="row" className={cx(styles.row, className)} {...rest} />;
}

type HeaderCellProps = ComponentPropsWithoutRef<"th"> & { width?: CSSProperties["width"] };

export function TableHeaderCell({ width, className, style, ...rest }: HeaderCellProps) {
  // width is a per-column value, so it is genuinely dynamic.
  return (
    <th
      scope="col"
      role="columnheader"
      className={cx(styles.th, className)}
      style={{ width, ...style }}
      {...rest}
    />
  );
}

type CellProps = ComponentPropsWithoutRef<"td"> & { hideOnMobile?: boolean };

export function TableCell({ hideOnMobile = false, className, ...rest }: CellProps) {
  return (
    <td role="cell" className={cx(styles.td, hideOnMobile && styles.hideOnMobile, className)} {...rest} />
  );
}
