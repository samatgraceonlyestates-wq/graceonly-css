"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { ARRIVAL_ROLES } from "@/lib/arrivalBatch";
import { requireAnyRole } from "@/lib/auth";
import { DbError } from "@/lib/db";
import { correctRecord } from "@/lib/corrections";
import { pgCorrectionStore } from "@/lib/correctionStore";
import { clockOutPerson, markNoSignout } from "@/lib/departures";
import { pgDepartureStore } from "@/lib/departureStore";
import { correctMovement } from "@/lib/movementCorrections";
import { pgMovementCorrectionStore, pgMovementStore } from "@/lib/movementStore";
import { recordDeparture, recordReturn } from "@/lib/movements";

// What a control on the board gets back: one line to show. Nothing typed is echoed.
export type BoardActionState = { status: "idle" } | { status: "done"; message: string } | { status: "error"; message: string };

const error = (message: string): BoardActionState => ({ status: "error", message });

// Clock one person out. Gated HERE: a server action is a public POST endpoint. A
// database failure comes back as the layer's fixed message and reference, never the
// database's own text (CLAUDE.md, "Database", the database error rule).
export async function clockOutAction(_previous: BoardActionState, formData: FormData): Promise<BoardActionState> {
  const { user, allowed } = await requireAnyRole(ARRIVAL_ROLES);
  if (!allowed) return error("Only the front desk can record a departure.");

  const recordId = formData.get("recordId");
  const timeOut = formData.get("timeOut");
  if (typeof recordId !== "string" || typeof timeOut !== "string") return error("That could not be read. Reload the page and try again.");

  try {
    const result = await clockOutPerson({ recordId, timeOut }, { store: pgDepartureStore, actorId: user.staffId, now: new Date() });
    if (!result.ok) return error(result.message);
    revalidatePath("/attendance");
    return { status: "done", message: `${result.name} clocked out at ${result.time}.` };
  } catch (caught) {
    if (caught instanceof DbError) return error(`${caught.message} Nothing was changed. Reference ${caught.errorId}.`);
    throw caught;
  }
}

// Mark people as never signed out: an explicit act on the people she names (one from
// the row, or everyone still showing IN from the end-of-day panel). Their hours
// become UNKNOWN; this never invents a time.
export async function markNoSignoutAction(_previous: BoardActionState, formData: FormData): Promise<BoardActionState> {
  const { user, allowed } = await requireAnyRole(ARRIVAL_ROLES);
  if (!allowed) return error("Only the front desk can close the day.");

  const recordIds = formData.getAll("recordId").filter((value): value is string => typeof value === "string");

  try {
    const result = await markNoSignout({ recordIds }, { store: pgDepartureStore, actorId: user.staffId, now: new Date() });
    if (!result.ok) return error(result.message);
    revalidatePath("/attendance");
    const note = result.skipped.length > 0 ? ` Not marked: ${result.skipped.map((s) => `${s.name} (${s.reason})`).join("; ")}.` : "";
    return {
      status: "done",
      message: `${result.marked} marked as not signed out.${note}`,
    };
  } catch (caught) {
    if (caught instanceof DbError) return error(`${caught.message} Nothing was changed. Reference ${caught.errorId}.`);
    throw caught;
  }
}

// Correct a record: a time in, a time out, undo a clock-out, undo a never-signed-out
// mark, or remove a record entered for the wrong person. EVERY correction carries a
// reason (checked in corrections.ts before anything is read). Both FRONT_DESK and ADMIN
// may correct: the reason is the control, not a role. The version she was looking at
// goes back with it, so a record someone else changed meanwhile is refused cleanly.
export async function correctRecordAction(_previous: BoardActionState, formData: FormData): Promise<BoardActionState> {
  const { user, allowed } = await requireAnyRole(ARRIVAL_ROLES);
  if (!allowed) return error("Only the front desk can correct attendance.");

  const text = (key: string) => {
    const value = formData.get(key);
    return typeof value === "string" ? value : "";
  };

  try {
    const result = await correctRecord(
      { recordId: text("recordId"), version: text("version"), kind: text("kind"), time: text("time"), reason: text("reason") },
      { store: pgCorrectionStore, actorId: user.staffId, now: new Date() },
    );
    if (!result.ok) return error(result.message);
    revalidatePath("/attendance");
    return { status: "done", message: result.message };
  } catch (caught) {
    if (caught instanceof DbError) return error(`${caught.message} Nothing was changed. Reference ${caught.errorId}.`);
    throw caught;
  }
}

// ---- the movement book -------------------------------------------------------------------

const textOf = (formData: FormData, key: string) => {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
};

/** The approver as the NameField sends it: what she typed, the person she picked (if any), and whether she said "a different person". */
const approverOf = (formData: FormData) => ({
  name: textOf(formData, "approverName"),
  personId: textOf(formData, "approverId") || null,
  confirmNew: textOf(formData, "approverConfirmNew") === "true",
});

// A person who is IN leaves the premises: where, what for, who approved it (a ROSTER
// person, by the same name rules as the arrivals sheet), and the time they left.
export async function recordDepartureAction(_previous: BoardActionState, formData: FormData): Promise<BoardActionState> {
  const { user, allowed } = await requireAnyRole(ARRIVAL_ROLES);
  if (!allowed) return error("Only the front desk can record a movement.");
  try {
    const result = await recordDeparture(
      {
        recordId: textOf(formData, "recordId"),
        destination: textOf(formData, "destination"),
        purpose: textOf(formData, "purpose"),
        timeLeft: textOf(formData, "timeLeft"),
        approver: approverOf(formData),
      },
      { store: pgMovementStore, actorId: user.staffId, now: new Date(), newId: randomUUID },
    );
    if (!result.ok) return error(result.message);
    revalidatePath("/attendance");
    return { status: "done", message: result.message };
  } catch (caught) {
    if (caught instanceof DbError) return error(`${caught.message} Nothing was saved. Reference ${caught.errorId}.`);
    throw caught;
  }
}

// A person who is OUT comes back. Recorded as returned_entered_by (the signed-in user),
// who may not be whoever recorded the departure.
export async function recordReturnAction(_previous: BoardActionState, formData: FormData): Promise<BoardActionState> {
  const { user, allowed } = await requireAnyRole(ARRIVAL_ROLES);
  if (!allowed) return error("Only the front desk can record a movement.");
  try {
    const result = await recordReturn(
      { movementId: textOf(formData, "movementId"), timeReturned: textOf(formData, "timeReturned") },
      { store: pgMovementStore, actorId: user.staffId, now: new Date(), newId: randomUUID },
    );
    if (!result.ok) return error(result.message);
    revalidatePath("/attendance");
    return { status: "done", message: result.message };
  } catch (caught) {
    if (caught instanceof DbError) return error(`${caught.message} Nothing was saved. Reference ${caught.errorId}.`);
    throw caught;
  }
}

// Correct a movement: the times, the destination, the purpose, the approver, remove it or
// restore it. EVERY one needs a reason; front desk and admin may both correct; the version
// she was looking at goes back with it.
export async function correctMovementAction(_previous: BoardActionState, formData: FormData): Promise<BoardActionState> {
  const { user, allowed } = await requireAnyRole(ARRIVAL_ROLES);
  if (!allowed) return error("Only the front desk can correct a movement.");
  try {
    const result = await correctMovement(
      {
        movementId: textOf(formData, "movementId"),
        version: textOf(formData, "version"),
        kind: textOf(formData, "kind"),
        time: textOf(formData, "time"),
        destination: textOf(formData, "destination"),
        purpose: textOf(formData, "purpose"),
        approver: approverOf(formData),
        reason: textOf(formData, "reason"),
      },
      { store: pgMovementCorrectionStore, actorId: user.staffId, now: new Date(), newId: randomUUID },
    );
    if (!result.ok) return error(result.message);
    revalidatePath("/attendance");
    return { status: "done", message: result.message };
  } catch (caught) {
    if (caught instanceof DbError) return error(`${caught.message} Nothing was changed. Reference ${caught.errorId}.`);
    throw caught;
  }
}
