"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { createCase, searchClients, listCaseTypes, type PortalCaseType } from "@/lib/portal";
import type { CaseSearchState, CreateCaseState } from "./types";

export async function searchClientsAction(
  _previous: CaseSearchState,
  formData: FormData,
): Promise<CaseSearchState> {
  await requireSession();
  const name = formData.get("name");
  const q = typeof name === "string" ? name.trim() : "";
  if (!q) return { status: "idle" };

  const result = await searchClients(q);
  if (!result.ok) {
    return { status: "error", message: result.error.message };
  }
  return {
    status: "results",
    candidates: result.data.candidates.map((c) => ({
      clientId: c.clientId,
      displayName: c.displayName,
      purchases: c.purchases.map((p) => ({ purchaseId: `${p.estate}:${p.label}`, label: `${p.label} · ${p.estateName}` })),
    })),
  };
}

export async function loadCaseTypesAction(): Promise<PortalCaseType[]> {
  await requireSession();
  const result = await listCaseTypes();
  return result.ok ? result.data : [];
}

const textOf = (formData: FormData, key: string) => {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
};

export async function createCaseAction(
  _previous: CreateCaseState,
  formData: FormData,
): Promise<CreateCaseState> {
  await requireSession();

  const clientId = textOf(formData, "clientId");
  const typeCode = textOf(formData, "typeCode");
  const subject = textOf(formData, "subject");
  const description = textOf(formData, "description");
  const purchaseId = textOf(formData, "purchaseId") || undefined;

  if (!clientId) return { status: "error", message: "Pick a client first." };
  if (!typeCode) return { status: "error", message: "Choose a case type." };
  if (typeCode === "REALTOR_CONDUCT") return { status: "error", message: "REALTOR_CONDUCT cases cannot be created from CSS." };
  if (!subject.trim()) return { status: "error", message: "A subject is required." };
  if (!description.trim()) return { status: "error", message: "A description is required." };

  const result = await createCase({
    clientId,
    typeCode,
    subject: subject.trim(),
    description: description.trim(),
    channel: "IN_PERSON",
    purchaseId,
  });

  if (!result.ok) {
    return { status: "error", message: result.error.message };
  }

  revalidatePath("/complaints");
  revalidatePath("/dashboard");
  redirect(`/complaints/${result.data.id}`);
}
