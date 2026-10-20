// UNDESIGNED: the change-password screen is not among the eight in Figma. It is
// built from the shared components and tokens only, and should be replaced when
// a design exists.
//
// A person with must_change_password reaches NOTHING ELSE until this is done:
// requireSession() in every other page and action redirects them here.
import type { Metadata } from "next";
import { Card } from "@/components/Card/Card";
import { requireSession, safeNext } from "@/lib/auth";
import { ChangePasswordForm } from "./ChangePasswordForm";
import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "Change password — CSS",
};

export const dynamic = "force-dynamic";

export default async function ChangePasswordPage({ searchParams }: { searchParams: Promise<{ next?: string | string[] }> }) {
  const user = await requireSession({ allowPasswordChange: true });
  const requested = (await searchParams).next;
  const next = safeNext(Array.isArray(requested) ? requested[0] : requested);

  return (
    <div className={styles.page}>
      <div className={styles.brand}>
        <span className={styles.logoMark} aria-hidden="true">
          G
        </span>
        <span className={styles.brandName}>CSS</span>
      </div>

      <main className={styles.main}>
        <Card as="section" aria-labelledby="change-heading" padding="lg" className={styles.card}>
          <h1 id="change-heading" className={styles.title}>
            Choose a new password
          </h1>
          <p className={styles.lede}>
            {user.mustChangePassword
              ? "Your password was set for you. Choose your own to continue; nothing else is available until you do."
              : "Enter your current password, then choose a new one. You will be signed out everywhere else."}
          </p>
          <ChangePasswordForm next={next} mustChange={user.mustChangePassword} />
        </Card>
      </main>
    </div>
  );
}
