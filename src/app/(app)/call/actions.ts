"use server";

import { requireAnyRole } from "@/lib/auth";
import { createStaffCall, type StaffMember, listStaffPortalStaff } from "@/lib/staffPortal";

// Front desk and the owner may call a colleague, the same roles that run the
// desk's other actions. The gate is enforced here, in the action, not only on
// the page: a server action is a public POST that never passes through a layout.
const CALL_ROLES = ["FRONT_DESK", "ADMIN"] as const;

/** A team-app colleague, as the picker lists them (client-safe: no server-only import leaks). */
export interface StaffOption {
  /** The TEAM-APP staff uuid — this is the calleeStaffId the /calls endpoint wants. */
  id: string;
  name: string;
  department: string | null;
  role: string;
}

export type StaffListState =
  | { status: "ok"; staff: StaffOption[] }
  | { status: "error"; message: string };

/** The live LiveKit call session the client needs to join the room. */
export interface CallSession {
  callId: string;
  room: string;
  livekitUrl: string;
  callerToken: string;
  calleeName: string;
}

export type CallState =
  | { status: "idle" }
  | { status: "calling"; session: CallSession }
  | { status: "error"; message: string };

const textOf = (formData: FormData, key: string) => {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
};

const toOption = (m: StaffMember): StaffOption => ({ id: m.id, name: m.fullName, department: m.department, role: m.role });

/** The roster for the picker, sourced from the TEAM APP (GET /api/team/v1/staff). */
export async function loadStaffAction(): Promise<StaffListState> {
  const { allowed } = await requireAnyRole(CALL_ROLES);
  if (!allowed) return { status: "error", message: "You do not have permission to call staff." };
  const result = await listStaffPortalStaff();
  if (!result.ok) return { status: "error", message: result.error.message };
  return { status: "ok", staff: result.data.map(toOption) };
}

export async function callStaffAction(_previous: CallState, formData: FormData): Promise<CallState> {
  const { user, allowed } = await requireAnyRole(CALL_ROLES);
  if (!allowed) return { status: "error", message: "You do not have permission to call staff." };

  const calleeStaffId = textOf(formData, "calleeStaffId").trim();
  if (!calleeStaffId) return { status: "error", message: "Choose a staff member to call." };

  // Place the call through the team app. It mints the LiveKit room + caller token
  // and rings the callee; the service key stays server-side (staffPortal.ts).
  const result = await createStaffCall({
    calleeStaffId,
    callerLabel: `Front Desk — ${user.fullName}`,
    kind: "audio",
  });
  if (!result.ok) return { status: "error", message: `Could not start the call: ${result.error.message}` };

  const d = result.data;
  return {
    status: "calling",
    session: {
      callId: d.callId,
      room: d.room,
      livekitUrl: d.livekitUrl,
      callerToken: d.callerToken,
      calleeName: d.callee.name,
    },
  };
}
