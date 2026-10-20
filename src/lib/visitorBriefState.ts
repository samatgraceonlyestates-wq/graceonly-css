// Screen 04, after the desk has picked a candidate: the little the result card
// needs from the client summary (fee rollup status and open cases, neither of
// which the search returns). Pure; only TYPES come from portal.ts, so this is
// safe in a client component. Nothing here is stored or logged.
import type { ClientSummary, PortalResult, RollupStatus } from "./portal.ts";
import { describeFailure, FAILURE_MESSAGE, type FailureDetail } from "./portalProblem.ts";
import { NOT_FOUND_MESSAGE, RATE_LIMITED_MESSAGE } from "./visitDetailState.ts";

export interface VisitorBrief {
  clientId: string;
  displayName: string;
  /** The first purchase (live ones come first), or null when there are none. */
  purchase: { estateName: string; label: string } | null;
  /** Further purchases beyond `purchase`. */
  morePurchases: number;
  /** The documentation fee rollup, which is the one fee pill. */
  feeStatus: RollupStatus;
  /** null only if the portal's case tables are absent. Excludes REALTOR_CONDUCT. */
  openCaseCount: number | null;
}

export type VisitorBriefState =
  | { kind: "loaded"; brief: VisitorBrief }
  | { kind: "not_found"; message: string }
  | { kind: "rate_limited"; message: string; retryAfterSeconds: number | null }
  | ({ kind: "failure" } & FailureDetail);

export function classifyBrief(requestedId: string, result: PortalResult<ClientSummary>): VisitorBriefState {
  if (!result.ok) {
    const { error } = result;
    if (error.kind === "not_found") return { kind: "not_found", message: NOT_FOUND_MESSAGE };
    if (error.kind === "rate_limited") {
      return { kind: "rate_limited", message: RATE_LIMITED_MESSAGE, retryAfterSeconds: error.retryAfterSeconds };
    }
    return { kind: "failure", ...describeFailure(error) };
  }

  const summary = result.data;
  // Never put one client's status on another's card.
  if (summary.clientId !== requestedId) {
    return { kind: "failure", cause: "unexpected", message: FAILURE_MESSAGE.unexpected, code: null, requestId: result.requestId };
  }

  const [first, ...rest] = summary.purchases;
  return {
    kind: "loaded",
    brief: {
      clientId: summary.clientId,
      displayName: summary.displayName,
      purchase: first ? { estateName: first.estateName, label: first.label } : null,
      morePurchases: rest.length,
      feeStatus: summary.documentationFee.status,
      openCaseCount: summary.openCaseCount,
    },
  };
}
