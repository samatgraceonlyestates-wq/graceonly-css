import type { Metadata } from "next";
import { PageHeader } from "@/components/PageHeader/PageHeader";
import { requireRole } from "@/lib/auth";
import { AddStaffForm } from "./AddStaffForm";

export const metadata: Metadata = {
  title: "Staff — Admin — CSS",
};

export const dynamic = "force-dynamic";

export default async function AdminStaffPage() {
  const { allowed } = await requireRole("ADMIN");
  if (!allowed) {
    return (
      <div>
        <PageHeader title="Admin" lede="You do not have permission to view this page." />
      </div>
    );
  }

  return (
    <div>
      <PageHeader title="Staff management" lede="Create login accounts for staff." />
      <AddStaffForm />
    </div>
  );
}
