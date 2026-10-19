import { cx } from "@/lib/cx";
import styles from "./FilterChips.module.css";

export type FilterChip = {
  label: string;
  count?: number;
  selected?: boolean;
};

// TODO: STATIC for now. These are a read-only summary (counts by type), not
// controls: no pointer cursor, no hover, not focusable. When filtering is
// wired, render each chip as a <button aria-pressed> and add hover/focus.
export function FilterChips({ items, label }: { items: FilterChip[]; label: string }) {
  return (
    <ul className={styles.list} aria-label={label}>
      {items.map((item) => (
        <li key={item.label} className={cx(styles.chip, item.selected && styles.selected)}>
          <span className={styles.label}>{item.label}</span>
          {item.count !== undefined ? <span className={styles.count}>{item.count}</span> : null}
        </li>
      ))}
    </ul>
  );
}
