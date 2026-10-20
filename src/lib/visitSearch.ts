// Screen 04 (New Visit): what a name search can come to, as states the UI can
// render. Pure: no I/O, no logging, and it holds nothing between calls.
//
// Only TYPES are imported from portal.ts (erased at build), so this file is
// safe to import from a client component and never pulls the key's module into
// a bundle.
//
// Five families, deliberately distinct:
//   candidates   the portal returned a LIST. It never chooses; the desk does.
//   no_match     a NON-CLIENT. A normal path: the visit is logged with no
//                clientId and anything they raise is an ENQUIRY, never a case.
//   guidance     QUERY_TOO_SHORT / QUERY_INVALID. What the desk sees while
//                typing too little. NOT a failure.
//   rate_limited 429. "Try again in a moment."
//   failure      401, 403, 503, a timeout, a network error, a missing
//                config, or a body the portal should not have sent.
//                "Something is wrong", not "try again".
//
// Nothing here carries a portal error body: messages are fixed text, and
// `code` and `requestId` are the portal's own identifiers, not client data.
import type { ClientCandidate, ClientSearch, PortalResult } from "./portal.ts";
import { describeFailure, type FailureCause } from "./portalProblem.ts";

export type { FailureCause };

export type VisitSearchOutcome =
  | {
      kind: "candidates";
      query: string;
      candidates: ClientCandidate[];
      /** True when the portal had more than it sent (at most 10, no paging). Say so; never show ten silently. */
      truncated: boolean;
    }
  | { kind: "no_match"; query: string }
  | { kind: "guidance"; reason: "empty" | "too_short" | "invalid"; message: string }
  | { kind: "rate_limited"; message: string; retryAfterSeconds: number | null }
  | { kind: "failure"; cause: FailureCause; message: string; code: string | null; requestId: string | null };

/** Before the first submit. The form's initial state. */
export type VisitSearchState = { kind: "idle" } | VisitSearchOutcome;

export const IDLE_SEARCH: VisitSearchState = { kind: "idle" };

export const GUIDANCE_MESSAGE = {
  empty: "Type the visitor's name, then search.",
  too_short: "Type at least two names, or one name of four or more letters.",
  invalid: "Type the visitor's name using letters, up to 100 characters.",
} as const;

export const RATE_LIMITED_MESSAGE = "Too many searches just now. Try again in a moment.";

/** Turns what portal.ts returned for a search into the one state the UI renders. */
export function classifySearch(query: string, result: PortalResult<ClientSearch>): VisitSearchOutcome {
  if (result.ok) {
    const { candidates, query: echoed } = result.data;
    return candidates.length === 0
      ? { kind: "no_match", query }
      : { kind: "candidates", query, candidates, truncated: echoed.truncated };
  }

  const { error } = result;

  if (error.kind === "bad_request" && error.code === "QUERY_TOO_SHORT") {
    return { kind: "guidance", reason: "too_short", message: GUIDANCE_MESSAGE.too_short };
  }
  if (error.kind === "bad_request" && error.code === "QUERY_INVALID") {
    return { kind: "guidance", reason: "invalid", message: GUIDANCE_MESSAGE.invalid };
  }

  if (error.kind === "rate_limited") {
    return { kind: "rate_limited", message: RATE_LIMITED_MESSAGE, retryAfterSeconds: error.retryAfterSeconds };
  }

  return { kind: "failure", ...describeFailure(error) };
}
