"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAnyRole } from "@/lib/auth";
import { DbError } from "@/lib/db";
import { HANDOVER_DOCUMENTS, HANDOVER_ROLES, recordHandover } from "@/lib/handovers";
import { pgHandoverStore, upsertSync } from "@/lib/handoverStore";
import { getReleaseCheck, releaseDocument, searchClients, type ActingStaff } from "@/lib/portal";
import { VISIT_ROLES, checkIn } from "@/lib/visits";
import { pgVisitStore } from "@/lib/visitStore";
import type { PickupSearchState, RecordPickupState } from "./types";

export async function searchClientsForPickupAction(
  _previous: PickupSearchState,
  formData: FormData,
): Promise<PickupSearchState> {
  await requireAnyRole(HANDOVER_ROLES);
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

const textOf = (formData: FormData, key: string) => {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
};

export async function recordPickupAction(
  _previous: RecordPickupState,
  formData: FormData,
): Promise<RecordPickupState> {
  const { user, allowed } = await requireAnyRole(VISIT_ROLES);
  if (!allowed) return { status: "error", message: "Only the front desk or an admin can record a document pickup." };

  const clientId = textOf(formData, "clientId");
  const clientName = textOf(formData, "clientName");
  const purchaseId = textOf(formData, "purchaseId") || null;
  const receivedByName = textOf(formData, "receivedByName").trim();
  const note = textOf(formData, "note").trim();

  if (!clientId) return { status: "error", message: "Pick a client first." };
  if (!clientName) return { status: "error", message: "Client name is missing." };

  const quantities: Record<string, string> = {};
  let hasAny = false;
  for (const doc of HANDOVER_DOCUMENTS) {
    const v = textOf(formData, `qty-${doc.code}`);
    quantities[doc.code] = v;
    if (v.trim() !== "" && v.trim() !== "0") hasAny = true;
  }
  if (!hasAny) return { status: "error", message: "Select at least one document." };

  try {
    const checkInResult = await checkIn(
      {
        visitorType: "CLIENT",
        reason: "DOCUMENT_COLLECTION",
        clientId,
        clientName,
        lookup: "MATCHED",
        toSee: "",
        consent: false,
        name: "",
        phone: "",
        organisation: "",
        sameVisitorId: "",
      },
      { store: pgVisitStore, actorId: user.staffId, newId: randomUUID, now: new Date() },
    );

    if (!checkInResult.ok) return { status: "error", message: checkInResult.kind === "refused" ? checkInResult.message : "Could not create the visit." };
    const visitId = checkInResult.visitId;

    const handoverResult = await recordHandover(
      {
        visitId,
        purchaseId: purchaseId ?? "",
        quantities,
        note: [receivedByName ? `Received by ${receivedByName}` : null, note || null].filter(Boolean).join(". "),
        acknowledgeUnverified: true,
        replacesHandoverId: "",
      },
      { store: pgHandoverStore, actorId: user.staffId, newId: randomUUID, releaseCheck: (cid) => getReleaseCheck(cid) },
    );

    if (!handoverResult.ok) return { status: "error", message: handoverResult.message };

    if (purchaseId) {
      const items = Object.entries(quantities)
        .filter(([, v]) => v.trim() !== "" && v.trim() !== "0")
        .map(([code, v]) => ({ code, quantity: Number(v) }));
      const actingStaff: ActingStaff = { id: user.staffId, name: user.fullName };
      for (const item of items) {
        try {
          const r = await releaseDocument(clientId, { documentType: item.code, purchaseId }, actingStaff);
          if (r.ok) await upsertSync(handoverResult.handoverId, r.data.releaseId, null);
          else await upsertSync(handoverResult.handoverId, null, r.error.message);
        } catch {
          await upsertSync(handoverResult.handoverId, null, "Could not reach the portal.");
        }
      }
    }

    revalidatePath("/documents");
    revalidatePath("/visits");
    revalidatePath("/dashboard");
    redirect(`/visits/${visitId}?checked=in`);
  } catch (caught) {
    if (caught instanceof DbError) return { status: "error", message: `${caught.message} Reference ${caught.errorId}.` };
    throw caught;
  }
}
