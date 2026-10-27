"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth";
import {
  escalateCase,
  moveCase,
  resolveCase,
  sendCaseMessage,
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

const CONFLICT_MESSAGE = "This case was updated by someone else. Please refresh.";

export async function sendMessageAction(
  _previous: CaseActionState,
  formData: FormData,
): Promise<CaseActionState> {
  await requireSession();
  const caseId = textOf(formData, "caseId");
  const body = textOf(formData, "body");
  const version = intOf(formData, "version");
  if (!body.trim()) return error("A message cannot be empty.");
  if (isNaN(version)) return error("Missing case version.");

  const result = await sendCaseMessage(caseId, { body: body.trim(), version });
  if (!result.ok) {
    if (result.error.kind === "conflict") return error(CONFLICT_MESSAGE);
    return error(result.error.message);
  }
  refresh(caseId);
  return { status: "done", message: "Message sent." };
}

export async function resolveCaseAction(
  _previous: CaseActionState,
  formData: FormData,
): Promise<CaseActionState> {
  await requireSession();
  const caseId = textOf(formData, "caseId");
  const body = textOf(formData, "body");
  const version = intOf(formData, "version");
  if (!body.trim()) return error("A resolution note is required.");
  if (isNaN(version)) return error("Missing case version.");

  const result = await resolveCase(caseId, { body: body.trim(), version });
  if (!result.ok) {
    if (result.error.kind === "conflict") return error(CONFLICT_MESSAGE);
    return error(result.error.message);
  }
  refresh(caseId);
  return { status: "done", message: "Case resolved." };
}

export async function escalateCaseAction(
  _previous: CaseActionState,
  formData: FormData,
): Promise<CaseActionState> {
  await requireSession();
  const caseId = textOf(formData, "caseId");
  const body = textOf(formData, "body");
  const version = intOf(formData, "version");
  if (!body.trim()) return error("An escalation reason is required.");
  if (isNaN(version)) return error("Missing case version.");

  const result = await escalateCase(caseId, { body: body.trim(), version });
  if (!result.ok) {
    if (result.error.kind === "conflict") return error(CONFLICT_MESSAGE);
    return error(result.error.message);
  }
  refresh(caseId);
  return { status: "done", message: "Case escalated." };
}

export async function moveCaseAction(
  _previous: CaseActionState,
  formData: FormData,
): Promise<CaseActionState> {
  await requireSession();
  const caseId = textOf(formData, "caseId");
  const newCaseType = textOf(formData, "newCaseType");
  const reason = textOf(formData, "reason");
  const version = intOf(formData, "version");
  if (!newCaseType) return error("Choose a case type.");
  if (!reason.trim()) return error("A reason for the change is required.");
  if (isNaN(version)) return error("Missing case version.");

  const result = await moveCase(caseId, { newCaseType, reason: reason.trim(), version });
  if (!result.ok) {
    if (result.error.kind === "conflict") return error(CONFLICT_MESSAGE);
    return error(result.error.message);
  }
  refresh(caseId);
  return { status: "done", message: "Case type changed." };
}
