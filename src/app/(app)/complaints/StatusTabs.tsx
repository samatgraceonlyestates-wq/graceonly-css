import Link from "next/link";
import { StatusPill } from "@/components/StatusPill/StatusPill";
import { cx } from "@/lib/cx";
import styles from "./StatusTabs.module.css";

// Local to the complaint queue: no other screen has tabs (03 and 08 use the
// static FilterChips). Each tab is a real link to a server-filtered view, so
// there is no client JS. If a second screen ever needs tabs, promote this to
// src/components/.
export type StatusTab = {
  key: string;
  label: string;
  count: number;
  tone: "green" | "amber" | "red" | "steel" | "neutral";
  href: string;
  selected: boolean;
};

export function StatusTabs({ tabs, label }: { tabs: StatusTab[]; label: string }) {
  return (
    <nav aria-label={label}>
      <ul className={styles.list}>
        {tabs.map((tab) => (
          <li key={tab.key}>
            <Link
              href={tab.href}
              className={cx(styles.tab, tab.selected && styles.selected)}
              aria-current={tab.selected ? "page" : undefined}
            >
              <span className={styles.label}>{tab.label}</span>
              {/* A tint with a dusk number; white on the selected burgundy tab.
                  Figma sets the badge number to its fill colour (invisible). */}
              <StatusPill tone={tab.tone} size="badge" onDark={tab.selected}>
                {tab.count}
              </StatusPill>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
