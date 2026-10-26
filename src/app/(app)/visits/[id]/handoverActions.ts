"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { requireAnyRole } from "@/lib/auth";
import { DbError } from "@/lib/db";
import { HANDOVER_DOCUMENTS, HANDOVER_ROLES, recordHandover, withdrawHandover, type Refusal } from "@/lib/handovers";
import { pgHandoverStore } from "@/lib/handoverStore";
import { getReleaseCheck } from "@/lib/portal";

// What the handover card gets back. "blocked" and "unverified" wrote NOTHING.
export type HandoverActionState =
  | { status: "idle" }
  | { status: "done"; message: string }
  | { status: "error"; message: string }
  | { status: "blocked"; message: string; refused: Refusal[] }
  | { status: "unverified"; message: string };

const textOf = (formData: FormData, key: string) => {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
};

// Record a handover. Gated HERE (a server action is a public POST endpoint). The portal's
// release-check is asked INSIDE this call, at the moment of recording (handovers.ts): the page's
// own banner is never reused as the answer. A database failure comes back as the layer's fixed
// message and a reference.
export async function recordHandoverAction(_previous: HandoverActionState, formData: FormData): Promise<HandoverActionState> {
  const { user, allowed } = await requireAnyRole(HANDOVER_ROLES);
  if (!allowed) return { status: "error", message: "Only the front desk or Legal can record a document handover." };
  const visitId = textOf(formData, "visitId");
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
      { store: pgHandoverStore, actorId: user.staffId, newId: randomUUID, releaseCheck: (clientId) => getReleaseCheck(clientId) },
    );
    if (result.ok) {
      revalidatePath(`/visits/${visitId}`);
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
