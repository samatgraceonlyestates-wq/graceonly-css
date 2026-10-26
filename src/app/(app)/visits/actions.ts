"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { requireAnyRole } from "@/lib/auth";
import { DbError } from "@/lib/db";
import { checkOut, closeDay, correctVisit, VISIT_ROLES } from "@/lib/visits";
import { pgVisitStore } from "@/lib/visitStore";

// What a control on 03 or 05 gets back: one line to show. Nothing typed is echoed.
export type VisitActionState = { status: "idle" } | { status: "done"; message: string } | { status: "error"; message: string };

const error = (message: string): VisitActionState => ({ status: "error", message });

const textOf = (formData: FormData, key: string) => {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
};

function refresh(visitId?: string) {
  revalidatePath("/visits");
  revalidatePath("/dashboard");
  if (visitId) revalidatePath(`/visits/${visitId}`);
}

// Each action is gated HERE: a server action is a public POST endpoint. A database failure
// comes back as the layer's fixed message and a reference, never the database's own text.
async function guarded(work: (actorId: string) => Promise<VisitActionState>, refused: string): Promise<VisitActionState> {
  const { user, allowed } = await requireAnyRole(VISIT_ROLES);
  if (!allowed) return error(refused);
  try {
    return await work(user.staffId);
  } catch (caught) {
    if (caught instanceof DbError) return error(`${caught.message} Nothing was changed. Reference ${caught.errorId}.`);
    throw caught;
  }
}

// Check one visitor out, now. Who did it is recorded.
export async function checkOutAction(_previous: VisitActionState, formData: FormData): Promise<VisitActionState> {
  return guarded(async (actorId) => {
    const visitId = textOf(formData, "visitId");
    const result = await checkOut({ visitId }, { store: pgVisitStore, actorId, now: new Date(), newId: randomUUID });
    if (!result.ok) return error(result.message);
    refresh(visitId);
    return { status: "done", message: `${result.name} checked out.` };
  }, "Only the front desk can check visitors out.");
}

// Close the visits still open at the end of the day: an explicit act on the visits she was
// shown, confirmed. AUTO_CLOSED with her name; when they left stays unknown.
export async function closeDayAction(_previous: VisitActionState, formData: FormData): Promise<VisitActionState> {
  return guarded(async (actorId) => {
    const visitIds = formData.getAll("visitId").filter((value): value is string => typeof value === "string");
    const result = await closeDay({ visitIds }, { store: pgVisitStore, actorId, now: new Date(), newId: randomUUID });
    if (!result.ok) return error(result.message);
    refresh();
    const note = result.skipped.length > 0 ? ` Not closed: ${result.skipped.map((skip) => `${skip.name} (${skip.reason})`).join("; ")}.` : "";
    return { status: "done", message: `${result.closed} ${result.closed === 1 ? "visit" : "visits"} closed with no time out.${note}` };
  }, "Only the front desk can close the day.");
}

// Correct a visit. EVERY correction carries a reason (checked in visits.ts before anything is
// read); the version she was looking at goes back with it.
export async function correctVisitAction(_previous: VisitActionState, formData: FormData): Promise<VisitActionState> {
  return guarded(async (actorId) => {
    const visitId = textOf(formData, "visitId");
    const result = await correctVisit(
      {
        visitId,
        version: textOf(formData, "version"),
        kind: textOf(formData, "kind"),
        time: textOf(formData, "time"),
        value: textOf(formData, "value"),
        reason: textOf(formData, "reason"),
      },
      { store: pgVisitStore, actorId, now: new Date(), newId: randomUUID },
    );
    if (!result.ok) return error(result.message);
    refresh(visitId);
    return { status: "done", message: result.message };
  }, "Only the front desk can correct a visit.");
}
