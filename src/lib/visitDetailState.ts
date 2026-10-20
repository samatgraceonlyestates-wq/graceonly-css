// Screen 05 (Visit Detail): what loading one client can come to, as states the
// UI can render. Pure: no I/O, no logging, nothing held between calls. Only
// TYPES are imported from portal.ts, so this is safe in a client component.
//
//   loaded        the summary arrived. Documents and the release position each
//                 carry their OWN outcome, so one part failing never blanks the
//                 screen or, worse, reads as an allow.
//   not_found     404. An unknown id, a malformed id and another client's id are
//                 the SAME 404 by design, so this must never say which.
//   rate_limited  429 on the summary: nothing to show yet, try again.
//   failure       401, 403, 503, timeout, network, config, or a body the portal
//                 should not have sent: something is wrong.
//
// RELEASE. Every state that is not an actual answer from the portal is
// "unknown, do not release". There is no quiet allow: the only way to reach a
// "may be handed over" reading is a real `checked` answer, and even then the
// desk reads the per-document `allowed` flags (see the traps in portal.ts).
import type {
  ClientDocuments,
  ClientSummary,
  PortalError,
  PortalResult,
  ReleaseCheck,
  ReleaseCheckAnswer,
} from "./portal.ts";
import { describeFailure, FAILURE_MESSAGE, type FailureCause, type FailureDetail } from "./portalProblem.ts";

export const RATE_LIMITED_MESSAGE = "Too many lookups just now. Try again in a moment.";
export const NOT_FOUND_MESSAGE = "No client found for that link. Go back and search again.";

/** One part of the screen that can arrive, or not, on its own. */
export type DetailPart<T> =
  | { status: "ok"; data: T }
  | { status: "rate_limited"; message: string; retryAfterSeconds: number | null }
  | ({ status: "failed" } & FailureDetail);

/** The literal the desk is told whenever the portal has not given a real answer. */
export type UnknownDoNotRelease = "unknown_do_not_release";

export const GATE_OFF_MESSAGE =
  "The document release gate is not switched on, so the portal cannot say whether anything may be handed over. Do not release documents from this screen.";
export const RELEASE_UNAVAILABLE_MESSAGE =
  "The release position could not be checked. Treat it as unknown. Do not release documents.";

export type ReleasePosition =
  /** The portal answered. Read `answer`: per-document `allowed`, and `summary.allLiveAllowed` (false when nothing is live). */
  | { kind: "checked"; answer: ReleaseCheckAnswer }
  /** 409 GATE_NOT_ACTIVE. A NORMAL state today, not a failure, and NOT an allow. */
  | { kind: "gate_off"; handOver: UnknownDoNotRelease; message: string }
  /** The check did not complete (429, 503, 401, network ...). Still not an allow. */
  | ({
      kind: "unavailable";
      handOver: UnknownDoNotRelease;
      cause: "rate_limited" | FailureCause;
      message: string;
      retryAfterSeconds: number | null;
      code: string | null;
      requestId: string | null;
    });

export type VisitDetailState =
  | { kind: "loaded"; summary: ClientSummary; documents: DetailPart<ClientDocuments>; release: ReleasePosition }
  | { kind: "not_found"; message: string }
  | { kind: "rate_limited"; message: string; retryAfterSeconds: number | null }
  | ({ kind: "failure" } & FailureDetail);

function part<T>(result: PortalResult<T>, belongsToClient: (data: T) => boolean): DetailPart<T> {
  if (result.ok) {
    // Never show one client's data on another's screen.
    return belongsToClient(result.data)
      ? { status: "ok", data: result.data }
      : { status: "failed", cause: "unexpected", message: FAILURE_MESSAGE.unexpected, code: null, requestId: result.requestId };
  }
  if (result.error.kind === "rate_limited") {
    return { status: "rate_limited", message: RATE_LIMITED_MESSAGE, retryAfterSeconds: result.error.retryAfterSeconds };
  }
  return { status: "failed", ...describeFailure(result.error) };
}

function releasePosition(result: PortalResult<ReleaseCheck>, clientId: string): ReleasePosition {
  const unavailable = (
    cause: "rate_limited" | FailureCause,
    error: Pick<PortalError, "code" | "requestId" | "retryAfterSeconds"> | null,
  ): ReleasePosition => ({
    kind: "unavailable",
    handOver: "unknown_do_not_release",
    cause,
    message: RELEASE_UNAVAILABLE_MESSAGE,
    retryAfterSeconds: error?.retryAfterSeconds ?? null,
    code: error?.code ?? null,
    requestId: error?.requestId ?? null,
  });

  if (!result.ok) {
    return unavailable(
      result.error.kind === "rate_limited" ? "rate_limited" : describeFailure(result.error).cause,
      result.error,
    );
  }

  const check = result.data;
  if (check.gate === "not_active") {
    return { kind: "gate_off", handOver: "unknown_do_not_release", message: GATE_OFF_MESSAGE };
  }
  // An answer about someone else is no answer.
  if (check.answer.clientId !== clientId) return unavailable("unexpected", { code: null, requestId: result.requestId, retryAfterSeconds: null });
  return { kind: "checked", answer: check.answer };
}

/**
 * The three portal results for one client (summary, documents, release-check)
 * as the one state the UI renders.
 */
export function classifyVisitDetail(
  requestedId: string,
  summary: PortalResult<ClientSummary>,
  documents: PortalResult<ClientDocuments>,
  release: PortalResult<ReleaseCheck>,
): VisitDetailState {
  // The portal makes unknown and malformed ids indistinguishable on purpose.
  // A 404 on any part means the client is not there to show.
  if ([summary, documents, release].some((result) => !result.ok && result.error.kind === "not_found")) {
    return { kind: "not_found", message: NOT_FOUND_MESSAGE };
  }

  // Without the summary there is no identity to show: the whole screen waits.
  if (!summary.ok) {
    if (summary.error.kind === "rate_limited") {
      return { kind: "rate_limited", message: RATE_LIMITED_MESSAGE, retryAfterSeconds: summary.error.retryAfterSeconds };
    }
    return { kind: "failure", ...describeFailure(summary.error) };
  }

  // The summary must be the client that was asked for.
  if (summary.data.clientId !== requestedId) {
    return { kind: "failure", cause: "unexpected", message: FAILURE_MESSAGE.unexpected, code: null, requestId: summary.requestId };
  }

  const clientId = requestedId;
  return {
    kind: "loaded",
    summary: summary.data,
    documents: part(documents, (data) => data.clientId === clientId),
    release: releasePosition(release, clientId),
  };
}
