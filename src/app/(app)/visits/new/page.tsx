import type { Metadata } from "next";
import { PageHeader } from "@/components/PageHeader/PageHeader";
import { NewVisitForm } from "./NewVisitForm";
import styles from "./page.module.css";

// UNVERIFIED AGAINST FIGMA: built from a written description of frames 27:2 and
// 27:59 (the Figma MCP quota was spent). See NewVisitForm.tsx for what to check.

export const metadata: Metadata = {
  title: "New visit — CSS",
};

// The lookup talks to the portal per request: never render at build time.
export const dynamic = "force-dynamic";

export default function NewVisitPage() {
  return (
    <div className={styles.page}>
      <PageHeader
        title={
          <>
            <span className={styles.desktopInline}>Who just walked in?</span>
            <span className={styles.mobileInline}>Who’s here?</span>
          </>
        }
        lede="Pick a visitor type, then look them up — or capture a new record."
      />
      <NewVisitForm />
    </div>
  );
}
