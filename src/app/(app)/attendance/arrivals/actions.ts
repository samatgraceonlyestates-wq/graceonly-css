"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { ARRIVAL_ROLES, saveArrivalBatch, parseBatchPayload, type NameConfirmation, type RowProblem } from "@/lib/arrivalBatch";
import { pgArrivalStore } from "@/lib/arrivalStore";
import { requireAnyRole } from "@/lib/auth";
import { DbError } from "@/lib/db";

// What the form needs back. Names and times are never echoed (they are already in
// the browser); only the outcome, and problems keyed to the row they belong to.
export type ArrivalsState =
  | { status: "idle" }
  | { status: "saved"; saved: number; newPeople: number; date: string }
  | { status: "refused"; formProblem: string | null; problems: RowProblem[]; confirmations: NameConfirmation[] };

// Save a page of arrivals. Gated HERE, not by the page that rendered the form: a
// server action is a public POST endpoint. Any database failure comes back as the
// layer's fixed message and its reference, never as the database's own text
// (CLAUDE.md, "Database", the database error rule).
export async function saveArrivalsAction(_previous: ArrivalsState, formData: FormData): Promise<ArrivalsState> {
  const { user, allowed } = await requireAnyRole(ARRIVAL_ROLES);
  const refuse = (formProblem: string): ArrivalsState => ({ status: "refused", formProblem, problems: [], confirmations: [] });
  if (!allowed) return refuse("Only the front desk can enter attendance.");

  const input = parseBatchPayload(formData.get("payload"));
  if (input === null) return refuse("That page could not be read. Nothing was saved. Reload the page and try again.");

  let result;
  try {
    result = await saveArrivalBatch(input, { store: pgArrivalStore, actorId: user.staffId, now: new Date(), newId: randomUUID });
  } catch (error) {
    if (error instanceof DbError) return refuse(`${error.message} Nothing was saved. Reference ${error.errorId}.`);
    throw error;
  }

  if (!result.ok) return { status: "refused", formProblem: result.formProblem, problems: result.problems, confirmations: result.confirmations };
  // New roster people may have been created: refresh the suggestions.
  revalidatePath("/attendance/arrivals");
  return { status: "saved", saved: result.saved, newPeople: result.newPeople, date: result.date };
}
