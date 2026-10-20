"use client";

import { useActionState } from "react";
import { loginAction, type LoginState } from "./actions";
import styles from "./page.module.css";

// The login form from Figma 23:2 / 23:50, unchanged, now wired to the sign-in
// action. method="post" is gone only because the action replaces it; the password
// still never goes in the URL. Without JavaScript the form still posts to the
// action, so signing in does not depend on the client bundle.
export function LoginForm({ next }: { next: string }) {
  const [state, formAction, pending] = useActionState<LoginState, FormData>(loginAction, { error: null, email: "" });

  return (
    <form className={styles.form} action={formAction}>
      <input type="hidden" name="next" value={next} />

      {state.error ? (
        <p className={styles.error} role="alert">
          {state.error}
        </p>
      ) : null}

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
        defaultValue={state.email}
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

      <button className={styles.submit} type="submit" disabled={pending}>
        Sign in
      </button>

      {/* TODO: there is no password-reset flow yet. An administrator resets a
          password for now; point this at a real route when one exists. */}
      <a className={styles.forgot} href="#">
        Forgot password?
      </a>
    </form>
  );
}
