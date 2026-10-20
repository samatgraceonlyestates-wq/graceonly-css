import type { ComponentPropsWithoutRef, CSSProperties } from "react";
import { cx } from "@/lib/cx";
import styles from "./Table.module.css";

// Table primitives for the visit log (03) and attendance register (08). Put the
// table inside <Card padding="table" plainOnMobile>.
//
// Below 768px a table becomes a stack of cards (both mobile designs do this;
// there is no horizontal scroll). The primitives supply the card chrome and
// hide the header row; the SCREEN decides the layout of each card:
//   - give TableRow a className that sets grid-template-columns/areas,
//   - give TableCell a className that sets grid-area,
//   - mark cells that do not appear on mobile with hideOnMobile.
// Card padding and gaps come from --table-card-pad-x, --table-card-pad-y,
// --table-card-gap (between cards) and --table-card-col-gap (between cells in a
// card); defaults 16, 14, 10 and 12, so a denser screen can override them.
// Explicit roles keep table semantics when the elements stop being display:table.

export function Table({ className, ...rest }: ComponentPropsWithoutRef<"table">) {
  return <table role="table" className={cx(styles.table, className)} {...rest} />;
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
