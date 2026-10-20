"use server";

import { lookupVisitor } from "@/lib/visitLookup";
import type { VisitSearchState } from "@/lib/visitSearch";

// The form's submit action for screen 04 (use it with useActionState and the
// IDLE_SEARCH initial state). It runs on the server, so the portal key never
// reaches the browser. One call per submit: nothing here is wired to typing.
// The previous state is ignored on purpose, so nothing about an earlier
// client carries into the next search.
export async function searchVisitorAction(_previous: VisitSearchState, formData: FormData): Promise<VisitSearchState> {
  const name = formData.get("name");
  return lookupVisitor(typeof name === "string" ? name : "");
}
