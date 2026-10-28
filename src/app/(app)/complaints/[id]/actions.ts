"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth";
import {
  escalateCase,
  resolveCase,
  sendCaseMessage,
  type ActingStaff,
} from "@/lib/portal";

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
