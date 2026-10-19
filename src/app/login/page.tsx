import type { Metadata } from "next";
import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "Sign in — CSS",
};

function LogoMark() {
  return (
    <span className={styles.logoMark} aria-hidden="true">
      G
    </span>
  );
}

export default function LoginPage() {
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

          {/* TODO: no auth yet, so this form is not wired to anything.
              method="post" is deliberate: it keeps the password out of the URL
              and browser history. Submitting returns a 405 for now; that goes
              away once real auth handles the POST. */}
          <form className={styles.form} method="post">
            <label className={styles.label} htmlFor="login-email">
              Email
            </label>
            <input
              id="login-email"
              className={styles.input}
              type="email"
              name="email"
              autoComplete="username"
              placeholder="you@graceonlyestates.com"
              required
            />

            <label className={styles.label} htmlFor="login-password">
              Password
            </label>
            <input
              id="login-password"
              className={styles.input}
              type="password"
              name="password"
              autoComplete="current-password"
              placeholder="••••••••••••"
              required
            />

            <button className={styles.submit} type="submit">
              Sign in
            </button>

            {/* TODO: point at the real reset route once it exists. */}
            <a className={styles.forgot} href="#">
              Forgot password?
            </a>
          </form>
        </section>

        <div className={styles.spaceBottom} aria-hidden="true" />
      </main>

      {/* TODO: the "Open on your phone" panel from Figma was removed. It can
          return as a real QR code pointing at the deployed URL. */}
    </div>
  );
}
