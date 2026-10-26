"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAnyRole, requireSession } from "@/lib/auth";
import { DbError } from "@/lib/db";
import type { CheckInState } from "@/lib/visitForm";
import { lookupVisitor } from "@/lib/visitLookup";
import type { VisitSearchState } from "@/lib/visitSearch";
import { loadVisitorBrief } from "@/lib/visitorBrief";
import type { VisitorBriefState } from "@/lib/visitorBriefState";
import { checkIn, VISIT_ROLES } from "@/lib/visits";
import { pgVisitStore } from "@/lib/visitStore";

// The form's submit action for screen 04 (use it with useActionState and the
// IDLE_SEARCH initial state). It runs on the server, so the portal key never
// reaches the browser. One call per submit: nothing here is wired to typing.
// The previous state is ignored on purpose, so nothing about an earlier
// client carries into the next search.
//
// A server action is a public POST endpoint, reachable without ever loading the
// page. So it checks the session itself, BEFORE anything is asked of the portal:
// otherwise anyone could search real client records without signing in.
export async function searchVisitorAction(_previous: VisitSearchState, formData: FormData): Promise<VisitSearchState> {
  await requireSession();
  const name = formData.get("name");
  return lookupVisitor(typeof name === "string" ? name : "");
}

// Called when the desk picks a candidate: one summary call for the result card.
// Same rule: the session is checked first.
export async function loadVisitorBriefAction(clientId: string): Promise<VisitorBriefState> {
  await requireSession();
  return loadVisitorBrief(typeof clientId === "string" ? clientId : "");
}

const textOf = (formData: FormData, key: string) => {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
};

// CHECK IN: writes the visit (and, for a non-client, their visitor record) to CSS's own
// database. It makes NO portal call: a client was picked from a search already made, and a
// failed search is recorded as PORTAL_UNAVAILABLE, so check-in works when the portal is down.
// Gated HERE (a server action is a public POST endpoint). On success it goes to the visit.
export async function checkInAction(_previous: CheckInState, formData: FormData): Promise<CheckInState> {
  const { user, allowed } = await requireAnyRole(VISIT_ROLES);
  if (!allowed) return { status: "error", message: "Only the front desk can check visitors in.", field: null };

  let visitId: string;
  try {
    const result = await checkIn(
      {
        visitorType: textOf(formData, "visitorType"),
        reason: textOf(formData, "reason"),
        toSee: textOf(formData, "toSee"),
        lookup: textOf(formData, "lookup"),
        clientId: textOf(formData, "clientId"),
        clientName: textOf(formData, "clientName"),
        name: textOf(formData, "name"),
        phone: textOf(formData, "phone"),
        organisation: textOf(formData, "organisation"),
        consent: textOf(formData, "consent") === "yes",
        sameVisitorId: textOf(formData, "sameVisitorId"),
      },
      { store: pgVisitStore, actorId: user.staffId, now: new Date(), newId: randomUUID },
    );
    if (!result.ok) {
      return result.kind === "confirm_visitor"
        ? { status: "confirm", message: result.message, visitor: { id: result.visitor.id, name: result.visitor.name } }
        : { status: "error", message: result.message, field: result.field };
    }
    visitId = result.visitId;
  } catch (caught) {
    // The database's own text never reaches the screen: its mapped message and a reference.
    if (caught instanceof DbError) {
      return { status: "error", message: `${caught.message} Nothing was saved. Reference ${caught.errorId}.`, field: caught.field };
    }
    throw caught;
  }
  revalidatePath("/visits");
  revalidatePath("/dashboard");
  // Outside the try: redirect() works by throwing.
  redirect(`/visits/${visitId}?checked=in`);
}
