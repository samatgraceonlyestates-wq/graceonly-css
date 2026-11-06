"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { buildTaskBody, isAssignmentPriority, type AssignmentCase } from "@/lib/assignments";
import { hasAssignment, recordAssignment } from "@/lib/assignmentStore";
import { DbError } from "@/lib/db";
import {
  escalateCase,
  getCase,
  resolveCase,
  sendCaseMessage,
  type ActingStaff,
} from "@/lib/portal";
import { createStaffTask, listStaffPortalStaff } from "@/lib/staffPortal";

export type CaseActionState =
  | { status: "idle" }
  | { status: "done"; message: string }
  | { status: "error"; message: string };

const error = (message: string): CaseActionState => ({ status: "error", message });

const textOf = (formData: FormData, key: string) => {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
};

const intOf = (formData: FormData, key: string) => {
  const value = formData.get(key);
  return typeof value === "string" ? parseInt(value, 10) : NaN;
};

function refresh(caseId: string) {
  revalidatePath(`/complaints/${caseId}`);
  revalidatePath("/complaints");
  revalidatePath("/dashboard");
}

function staffOf(user: { staffId: string; fullName: string }): ActingStaff {
  return { id: user.staffId, name: user.fullName };
}

const CONFLICT_MESSAGE = "This case was updated by someone else. Please refresh.";

export async function sendMessageAction(
  _previous: CaseActionState,
  formData: FormData,
): Promise<CaseActionState> {
  const user = await requireSession();
  const caseId = textOf(formData, "caseId");
  const body = textOf(formData, "body");
  const version = intOf(formData, "version");
  if (!body.trim()) return error("A message cannot be empty.");
  if (isNaN(version)) return error("Missing case version.");

  const result = await sendCaseMessage(
    caseId,
    { message: body.trim(), channel: "IN_PERSON", version },
    staffOf(user),
  );
  if (!result.ok) {
    if (result.error.kind === "conflict") return error(CONFLICT_MESSAGE);
    return error(result.error.message);
  }
  refresh(caseId);
  redirect(`/complaints/${caseId}`);
}

export async function resolveCaseAction(
  _previous: CaseActionState,
  formData: FormData,
): Promise<CaseActionState> {
  const user = await requireSession();
  const caseId = textOf(formData, "caseId");
  const body = textOf(formData, "body");
  const version = intOf(formData, "version");
  if (!body.trim()) return error("A resolution note is required.");
  if (isNaN(version)) return error("Missing case version.");

  const result = await resolveCase(
    caseId,
    { resolutionNote: body.trim(), version },
    staffOf(user),
  );
  if (!result.ok) {
    if (result.error.kind === "conflict") return error(CONFLICT_MESSAGE);
    return error(result.error.message);
  }
  refresh(caseId);
  redirect(`/complaints/${caseId}`);
}

// ===== Assign to staff (the staff portal's team:* API) =======================
//
// INDEPENDENT of the portal's own escalate/status: this does NOT touch the
// complaint's portal status. It creates a TASK in the STAFF portal for a
// colleague and logs CSS's outbound action locally (migration 020). Any
// signed-in user may do it, matching the complaint screens' current openness.

/** A staff-portal colleague, as the dialog lists them (client-safe: no server-only import). */
export interface StaffOption {
  email: string;
  name: string;
  department: string | null;
  role: string;
}

export type StaffListState =
  | { status: "ok"; staff: StaffOption[] }
  | { status: "error"; message: string };

export type AssignState =
  | { status: "idle" }
  | { status: "done"; message: string; taskLink: string | null }
  | { status: "error"; message: string };

/** Loads the staff portal's roster for the dialog (like loadCaseTypesAction for the new-case form). */
export async function loadStaffAction(): Promise<StaffListState> {
  await requireSession();
  const result = await listStaffPortalStaff();
  if (!result.ok) return { status: "error", message: result.error.message };
  return {
    status: "ok",
    staff: result.data.map((m) => ({ email: m.email, name: m.fullName, department: m.department, role: m.role })),
  };
}

export async function assignToStaffAction(
  _previous: AssignState,
  formData: FormData,
): Promise<AssignState> {
  const user = await requireSession();
  const caseId = textOf(formData, "caseId");
  const assigneeEmail = textOf(formData, "assigneeEmail").trim();
  const assigneeName = textOf(formData, "assigneeName").trim();
  const priorityRaw = textOf(formData, "priority").trim();
  const confirmRepeat = textOf(formData, "confirmRepeat") === "yes";

  if (!caseId) return { status: "error", message: "Missing the complaint reference." };
  if (!assigneeEmail || !assigneeName) return { status: "error", message: "Choose a staff member to assign." };

  const priority = priorityRaw === "" ? null : isAssignmentPriority(priorityRaw) ? priorityRaw : null;
  if (priorityRaw !== "" && priority === null) return { status: "error", message: "That priority is not one of the options." };

  // No silent duplicate: a repeat assignment needs an explicit confirmation.
  try {
    if (!confirmRepeat && (await hasAssignment(caseId))) {
      return { status: "error", message: "This dispute is already assigned. Tick the box to confirm assigning it again." };
    }
  } catch (caught) {
    if (caught instanceof DbError) return { status: "error", message: `${caught.message} Reference ${caught.errorId}.` };
    throw caught;
  }

  // Authoritative case facts from the client portal — never the complaint content
  // from a hidden field, which a forged POST could change.
  const caseResult = await getCase(caseId);
  if (!caseResult.ok) {
    return { status: "error", message: `Could not load the complaint to assign it: ${caseResult.error.message}` };
  }
  const c = caseResult.data;
  const caseInfo: AssignmentCase = {
    id: c.id,
    subject: c.subject,
    reference: c.reference,
    description: c.description,
    kind: c.kind,
    typeText: c.typeLabel ?? c.typeCode,
  };

  const publicOrigin = process.env.CSS_PUBLIC_ORIGIN?.trim() || null;
  const body = buildTaskBody({ caseInfo, assigneeEmail, idempotencyKey: randomUUID(), publicOrigin, priority });

  const taskResult = await createStaffTask(body);
  if (!taskResult.ok) {
    return { status: "error", message: `The task was not created in the staff portal: ${taskResult.error.message}` };
  }
  const taskLink = taskResult.data.taskUrl || null;

  // Log CSS's outbound action. The task is ALREADY created in the staff portal;
  // if only the local log fails, say so honestly rather than hide it.
  try {
    await recordAssignment({
      id: randomUUID(),
      caseId,
      assigneeEmail,
      assigneeName,
      priority,
      taskId: taskResult.data.taskId,
      taskLink,
      assignedBy: user.staffId,
      replayed: taskResult.data.replayed,
    });
  } catch (caught) {
    if (caught instanceof DbError) {
      return {
        status: "done",
        taskLink,
        message: `Assigned to ${assigneeName} in the staff portal, but the local record did not save (reference ${caught.errorId}).`,
      };
    }
    throw caught;
  }

  refresh(caseId);
  return {
    status: "done",
    taskLink,
    message: taskResult.data.replayed
      ? `This dispute was already assigned to ${assigneeName}; the existing task was reused.`
      : `Assigned to ${assigneeName}.`,
  };
}

export async function escalateCaseAction(
  _previous: CaseActionState,
  formData: FormData,
): Promise<CaseActionState> {
  const user = await requireSession();
  const caseId = textOf(formData, "caseId");
  const body = textOf(formData, "body");
  const version = intOf(formData, "version");
  if (!body.trim()) return error("An escalation reason is required.");
  if (isNaN(version)) return error("Missing case version.");

  const result = await escalateCase(
    caseId,
    { reason: body.trim(), version },
    staffOf(user),
  );
  if (!result.ok) {
    if (result.error.kind === "conflict") return error(CONFLICT_MESSAGE);
    return error(result.error.message);
  }
  refresh(caseId);
  redirect(`/complaints/${caseId}`);
}
