"use server";

import { requireSession } from "@/lib/auth";
import { lookupVisitor } from "@/lib/visitLookup";
import type { VisitSearchState } from "@/lib/visitSearch";
import { loadVisitorBrief } from "@/lib/visitorBrief";
import type { VisitorBriefState } from "@/lib/visitorBriefState";

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
