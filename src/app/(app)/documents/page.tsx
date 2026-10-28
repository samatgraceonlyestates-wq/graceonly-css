import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/PageHeader/PageHeader";
import { requireAnyRole } from "@/lib/auth";
import { HANDOVER_ROLES } from "@/lib/handovers";
import { PickupForm } from "./PickupForm";
import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "Documents — CSS",
};

export const dynamic = "force-dynamic";

export default async function DocumentsPage() {
  const { allowed } = await requireAnyRole(HANDOVER_ROLES);
  if (!allowed) {
    return (
      <div>
        <PageHeader title="Documents" lede="You do not have permission to view this page." />
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Quick pickup"
        lede="Record a document collection without a full visit check-in."
      />
      <div className={styles.navRow}>
        <Link href="/documents/history" className={styles.navLink}>View handover history →</Link>
      </div>
      <PickupForm />
    </div>
  );
}
