"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { requireAnyRole } from "@/lib/auth";
import { DbError } from "@/lib/db";
import { HANDOVER_DOCUMENTS, HANDOVER_ROLES, recordHandover, withdrawHandover, type Refusal } from "@/lib/handovers";
import { pgHandoverStore, upsertSync } from "@/lib/handoverStore";
import { getReleaseCheck, releaseDocument, type ActingStaff } from "@/lib/portal";

// What the handover card gets back. "blocked" and "unverified" wrote NOTHING.
export type HandoverActionState =
  | { status: "idle" }
  | { status: "done"; message: string; portalWarning?: string }
  | { status: "error"; message: string }
  | { status: "blocked"; message: string; refused: Refusal[] }
  | { status: "unverified"; message: string };

const textOf = (formData: FormData, key: string) => {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
};

function staffOf(user: { staffId: string; fullName: string }): ActingStaff {
  return { id: user.staffId, name: user.fullName };
}

async function syncToPortal(
  handoverId: string,
  clientId: string,
  purchaseId: string | null,
  items: { code: string; quantity: number }[],
  actingStaff: ActingStaff,
): Promise<string | null> {
  if (!purchaseId) return "No purchase selected — cannot sync to portal.";
  for (const item of items) {
    try {
      const result = await releaseDocument(
        clientId,
        { documentType: item.code, purchaseId },
        actingStaff,
      );
      if (result.ok) {
        await upsertSync(handoverId, result.data.releaseId, null);
      } else {
        await upsertSync(handoverId, null, result.error.message);
        return result.error.message;
      }
    } catch {
      const msg = "Could not reach the portal.";
      await upsertSync(handoverId, null, msg);
      return msg;
    }
  }
  return null;
}

// Record a handover. Gated HERE (a server action is a public POST endpoint). The portal's
// release-check is asked INSIDE this call, at the moment of recording (handovers.ts): the page's
// own banner is never reused as the answer. A database failure comes back as the layer's fixed
// message and a reference.
//
// After the LOCAL record succeeds, the portal's release endpoint is called too. If that fails,
// the local record is KEPT and a warning is shown (the portal can be told later via retry).
export async function recordHandoverAction(_previous: HandoverActionState, formData: FormData): Promise<HandoverActionState> {
  const { user, allowed } = await requireAnyRole(HANDOVER_ROLES);
  if (!allowed) return { status: "error", message: "Only the front desk or Legal can record a document handover." };
  const visitId = textOf(formData, "visitId");
  const clientId = textOf(formData, "clientId");
  const purchaseId = textOf(formData, "purchaseId") || null;
  const quantities: Record<string, string> = {};
  for (const document of HANDOVER_DOCUMENTS) quantities[document.code] = textOf(formData, `qty-${document.code}`);
  try {
    const result = await recordHandover(
      {
        visitId,
        purchaseId: textOf(formData, "purchaseId"),
        quantities,
        note: textOf(formData, "note"),
        acknowledgeUnverified: textOf(formData, "acknowledgeUnverified") === "yes",
        replacesHandoverId: textOf(formData, "replacesHandoverId"),
      },
      { store: pgHandoverStore, actorId: user.staffId, newId: randomUUID, releaseCheck: (cid) => getReleaseCheck(cid) },
    );
    if (result.ok) {
      const items = Object.entries(quantities)
        .filter(([, v]) => v.trim() !== "" && v.trim() !== "0")
        .map(([code, v]) => ({ code, quantity: Number(v) }));
      const portalError = await syncToPortal(result.handoverId, clientId, purchaseId, items, staffOf(user));
      revalidatePath(`/visits/${visitId}`);
      if (portalError) {
        return { status: "done", message: result.message, portalWarning: `Not synced to portal: ${portalError}` };
      }
      return { status: "done", message: result.message };
    }
    if (result.kind === "blocked") return { status: "blocked", message: result.message, refused: result.refused };
    if (result.kind === "unverified") return { status: "unverified", message: result.message };
    return { status: "error", message: result.message };
  } catch (caught) {
    if (caught instanceof DbError) return { status: "error", message: `${caught.message} Nothing was recorded. Reference ${caught.errorId}.` };
    throw caught;
  }
}

// Retry syncing a handover to the portal. Reads the handover's visit to get the client id,
// then calls releaseDocument for each item.
export async function retrySyncAction(_previous: HandoverActionState, formData: FormData): Promise<HandoverActionState> {
  const { user, allowed } = await requireAnyRole(HANDOVER_ROLES);
  if (!allowed) return { status: "error", message: "Only the front desk or Legal can sync a document handover." };
  const handoverId = textOf(formData, "handoverId");
  const clientId = textOf(formData, "clientId");
  const purchaseId = textOf(formData, "purchaseId") || null;
  const visitId = textOf(formData, "visitId");
  if (!purchaseId) return { status: "error", message: "No purchase — cannot sync to portal." };

  const itemCodes = formData.getAll("itemCode").filter((v): v is string => typeof v === "string");
  const itemQtys = formData.getAll("itemQty").filter((v): v is string => typeof v === "string");
  const items = itemCodes.map((code, i) => ({ code, quantity: Number(itemQtys[i] ?? "1") }));

  const portalError = await syncToPortal(handoverId, clientId, purchaseId, items, staffOf(user));
  revalidatePath(`/visits/${visitId}`);
  if (portalError) return { status: "error", message: `Retry failed: ${portalError}` };
  return { status: "done", message: "Synced to portal." };
}

// Withdraw a wrong record: a correction APPENDED with its reason (018). The original stays.
export async function withdrawHandoverAction(_previous: HandoverActionState, formData: FormData): Promise<HandoverActionState> {
  const { user, allowed } = await requireAnyRole(HANDOVER_ROLES);
  if (!allowed) return { status: "error", message: "Only the front desk or Legal can correct a document handover." };
  try {
    const result = await withdrawHandover(
      { handoverId: textOf(formData, "handoverId"), reason: textOf(formData, "reason") },
      { store: pgHandoverStore, actorId: user.staffId, newId: randomUUID },
    );
    if (!result.ok) return { status: "error", message: result.message };
    revalidatePath(`/visits/${textOf(formData, "visitId")}`);
    return { status: "done", message: result.message };
  } catch (caught) {
    if (caught instanceof DbError) return { status: "error", message: `${caught.message} Nothing was changed. Reference ${caught.errorId}.` };
    throw caught;
  }
}
