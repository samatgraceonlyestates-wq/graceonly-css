// Screen 04 (New Visit): who the form is about to check in, and what the lookup came to,
// decided from what the desk has done on the screen. Pure, and safe in a client component
// (only types come from portal.ts, through visitSearch.ts).
//
// THE OUTCOME IS WHAT HAPPENED, NOT WHAT IS CONVENIENT:
//   a non-client type                      NOT_LOOKED_UP (nothing is searched)
//   a Client, picked from the portal list  MATCHED
//   a Client, the portal found nobody, or
//     the desk said "none of these"        NO_MATCH
//   a Client whose search FAILED (the
//     portal down, refusing, or too busy)  PORTAL_UNAVAILABLE: she checks them in anyway,
//                                          and the visit says it is not verified
//   a Client not looked up yet, or a
//     search only asking for more letters  nobody yet: look them up first
// Results belong to the name they were searched for: change the name and they no longer
// count, so an old search can never stand behind a new person.
import type { VisitSearchState } from "./visitSearch.ts";

/** The candidate list's own last option: the visitor is not any of them. */
export const NOT_LISTED = "__not_listed__";

export type CheckInState =
  | { status: "idle" }
  | { status: "error"; message: string; field: string | null }
  /** Their number is on file for someone: is it them? Nothing has been written. */
  | { status: "confirm"; message: string; visitor: { id: string; name: string } };

export const IDLE_CHECK_IN: CheckInState = { status: "idle" };

export type FormPerson =
  | { kind: "client"; lookup: "MATCHED"; clientId: string; name: string }
  | { kind: "visitor"; lookup: "NOT_LOOKED_UP" | "NO_MATCH" | "PORTAL_UNAVAILABLE"; name: string };

export function personFor(input: {
  isClient: boolean;
  typedName: string;
  search: VisitSearchState;
  searchedName: string;
  picked: string | null;
}): FormPerson | null {
  const { isClient, typedName, search, searchedName, picked } = input;
  if (!isClient) return typedName === "" ? null : { kind: "visitor", lookup: "NOT_LOOKED_UP", name: typedName };
  // Results for another name do not count.
  if (search.kind === "idle" || searchedName !== typedName || typedName === "") return null;
  switch (search.kind) {
    case "no_match":
      return { kind: "visitor", lookup: "NO_MATCH", name: searchedName };
    case "candidates": {
      if (picked === NOT_LISTED) return { kind: "visitor", lookup: "NO_MATCH", name: searchedName };
      const candidate = search.candidates.find((entry) => entry.clientId === picked);
      return candidate ? { kind: "client", lookup: "MATCHED", clientId: candidate.clientId, name: candidate.displayName } : null;
    }
    case "failure":
    case "rate_limited":
      return { kind: "visitor", lookup: "PORTAL_UNAVAILABLE", name: searchedName };
    case "guidance":
      return null;
  }
}
