"use server";

import { revalidatePath } from "next/cache";
import { ARRIVAL_ROLES } from "@/lib/arrivalBatch";
import { requireAnyRole } from "@/lib/auth";
import { DbError } from "@/lib/db";
import { clockOutPerson, markNoSignout } from "@/lib/departures";
import { pgDepartureStore } from "@/lib/departureStore";

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
