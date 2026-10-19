"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cx } from "@/lib/cx";
import { NAV_ITEMS, isActive } from "./navItems";
import styles from "./AppShell.module.css";

export function NavLinks() {
  const pathname = usePathname();

  return (
    <nav className={styles.links} aria-label="Primary">
      <ul className={styles.linkList}>
        {NAV_ITEMS.map((item) => {
          const active = isActive(pathname, item.href);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                className={cx(styles.link, active && styles.linkActive)}
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
