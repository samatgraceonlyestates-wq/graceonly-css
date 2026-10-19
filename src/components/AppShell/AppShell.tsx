import Link from "next/link";
import type { ReactNode } from "react";
import { Avatar } from "@/components/Avatar/Avatar";
import { Button } from "@/components/Button/Button";
import { NavLinks } from "./NavLinks";
import { TabBar } from "./TabBar";
import styles from "./AppShell.module.css";

// Wraps every signed-in screen (02 to 08). Login has its own bar and does not
// use this. Desktop: floating nav. Mobile: top bar plus a bottom tab bar.
export function AppShell({ user, children }: { user: { name: string }; children: ReactNode }) {
  const signedInAs = `Signed in as ${user.name}`;

  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <div className={styles.bar}>
          <Link href="/dashboard" className={styles.brand} aria-label="CSS dashboard">
            <span className={styles.logoMark} aria-hidden="true">
              G
            </span>
            <span className={styles.brandName}>CSS</span>
          </Link>

          <NavLinks />

          <div className={styles.actions}>
            {/* Shown on mobile too: starting a visit is the front desk's main action.
                TODO: point at the New Visit screen (04) when it exists. */}
            <span className={styles.newVisit}>
              <Button href="/visits/new" size="compact">
                + New visit
              </Button>
            </span>
            <span className={styles.avatarDesktop}>
              <Avatar name={user.name} size={40} tone="solid" label={signedInAs} />
            </span>
            <span className={styles.avatarMobile}>
              <Avatar name={user.name} size={36} tone="solid" label={signedInAs} />
            </span>
          </div>
        </div>
      </header>

      <main className={styles.main}>{children}</main>

      <TabBar />
    </div>
  );
}
