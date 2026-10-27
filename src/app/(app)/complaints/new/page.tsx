import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/PageHeader/PageHeader";
import { requireSession } from "@/lib/auth";
import { NewCaseForm } from "./NewCaseForm";

export const metadata: Metadata = {
  title: "New complaint — CSS",
};

export const dynamic = "force-dynamic";

export default async function NewComplaintPage() {
  await requireSession();

  return (
    <div>
      <PageHeader
        eyebrow={<Link href="/complaints" style={{ color: "var(--fold-gold)", fontSize: "13px", fontWeight: 500, textDecoration: "none" }}>← Back to complaints</Link>}
        title="New complaint"
        lede="Open a support case for a client through the portal."
      />
      <NewCaseForm />
    </div>
  );
}
