import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSession, safeNext } from "@/lib/auth";
import { LoginForm } from "./LoginForm";
import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "Sign in — CSS",
};

// Reads the session cookie, so it is rendered per request.
export const dynamic = "force-dynamic";

function LogoMark() {
  return (
    <span className={styles.logoMark} aria-hidden="true">
      G
    </span>
  );
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string | string[] }> }) {
  const requested = (await searchParams).next;
  const next = safeNext(Array.isArray(requested) ? requested[0] : requested);

  // Already signed in: go where they were heading. If the database cannot be
  // reached, show the form anyway; signing in will say what is wrong.
  let user = null;
  try {
    user = await getSession();
  } catch {
    user = null;
  }
  if (user !== null) redirect(user.mustChangePassword ? `/change-password?next=${encodeURIComponent(next)}` : next);

  return (
    <div className={styles.page}>
      {/* Mobile brand bar */}
      <div className={styles.brand}>
        <LogoMark />
        <span className={styles.brandName}>CSS</span>
      </div>

      {/* Desktop floating bar: logo mark and wordmark only. The marketing links
          from the Figma template are intentionally left out (internal app, no
          public pages). */}
      <header className={styles.navWrap}>
        <div className={styles.nav}>
          <span className={styles.navLogo}>
            <LogoMark />
            <span className={styles.brandName}>CSS</span>
          </span>
        </div>
      </header>

      <main className={styles.hero}>
        <p className={styles.tag}>
          <span className={styles.tagDot} aria-hidden="true" />
          <span className={styles.tagTextDesktop}>
            Graceonly · Customer Support System
          </span>
          <span className={styles.tagTextMobile}>Customer Support</span>
        </p>

        <h1 className={styles.headline}>
          <span>The front desk,</span> <span>done well.</span>
        </h1>

        <p className={styles.lede}>
          Every walk-in logged. Every complaint tracked.
          <span className={styles.ledeExtra}>
            {" "}
            Every document accounted for.
          </span>
        </p>

        <div className={styles.spaceTop} aria-hidden="true" />

        <section className={styles.card} aria-labelledby="login-heading">
          <h2 id="login-heading" className={styles.cardTitle}>
            <span className={styles.cardTitleDesktop}>Sign in to continue</span>
            <span className={styles.cardTitleMobile}>Sign in</span>
          </h2>

          <LoginForm next={next} />
        </section>

        <div className={styles.spaceBottom} aria-hidden="true" />
      </main>

      {/* TODO: the "Open on your phone" panel from Figma was removed. It can
          return as a real QR code pointing at the deployed URL. */}
    </div>
  );
}
