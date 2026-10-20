import type { ReactNode } from "react";
import { signOutAction } from "@/lib/authActions";
import styles from "./UserMenu.module.css";

// NOT IN FIGMA. Figma draws the avatar and nothing to sign out with, but signing
// out has to be reachable on a phone as well as on a desk. This is a PLACEHOLDER
// pending a real design: the avatar opens a small panel with the person's name
// and a Sign out button. Plain <details>, so it needs no script and works from
// the keyboard; it stays open until the avatar is pressed again.
//
// Sign out revokes the session row on the server (see authActions.ts).
export function UserMenu({ name, children }: { name: string; children: ReactNode }) {
  return (
    <details className={styles.menu}>
      <summary className={styles.trigger} aria-label={`Account menu, signed in as ${name}`}>
        {children}
      </summary>
      <div className={styles.panel}>
        <p className={styles.who}>{name}</p>
        <form action={signOutAction}>
          <button type="submit" className={styles.signOut}>
            Sign out
          </button>
        </form>
      </div>
    </details>
  );
}
