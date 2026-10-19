"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cx } from "@/lib/cx";
import { NAV_ITEMS, isActive } from "./navItems";
import styles from "./AppShell.module.css";

// PLACEHOLDER: this bottom tab bar is NOT in the Figma file. It exists only
// because the mobile designs give a phone user no way to reach any other
// screen. Plain text tabs, existing tokens only. Replace once it is designed.
export function TabBar() {
  const pathname = usePathname();

  return (
    <nav className={styles.tabBar} aria-label="Primary">
      <ul className={styles.tabList}>
        {NAV_ITEMS.map((item) => {
          const active = isActive(pathname, item.href);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                className={cx(styles.tab, active && styles.tabActive)}
                aria-current={active ? "page" : undefined}
              >
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
