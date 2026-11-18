// "Call a staff" (UNDESIGNED, not in Figma): the front desk picks a colleague and
// places a REAL two-way audio call through the TEAM APP.
//  - The picker's roster comes from the TEAM APP (GET /api/team/v1/staff), because
//    the callee must be a team-app staff uuid (not a CSS staff id).
//  - Pressing Call POSTs to the team app's /calls endpoint (server-side, key kept
//    server-side), which mints a LiveKit room + caller token; the client joins it.
import type { Metadata } from "next";
import { Card } from "@/components/Card/Card";
import { PageHeader } from "@/components/PageHeader/PageHeader";
import { requireAnyRole } from "@/lib/auth";
import { CallStaff } from "./CallStaff";
import { loadStaffAction } from "./actions";

export const metadata: Metadata = {
  title: "Call staff — CSS",
};

export const dynamic = "force-dynamic";

const CALL_ROLES = ["FRONT_DESK", "ADMIN"] as const;

export default async function CallStaffPage() {
  const { allowed } = await requireAnyRole(CALL_ROLES);
  if (!allowed) {
    return (
      <div>
        <PageHeader title="Call staff" lede="You do not have permission to view this page." />
      </div>
    );
  }

  const staffState = await loadStaffAction();

  return (
    <div>
      <PageHeader title="Call staff" lede="Pick a staff member and place an audio call." />
      <div style={{ marginTop: "var(--fold-space-20)" }}>
        <Card as="section" padding="lg">
          <CallStaff staffState={staffState} />
        </Card>
      </div>
    </div>
  );
}
