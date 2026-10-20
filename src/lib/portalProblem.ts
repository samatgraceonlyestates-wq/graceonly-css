// Shared by the screen 04 and 05 data layers: how a portal failure is told to
// the desk. Pure. Messages are fixed text; the portal's own error text is never
// passed on, because it could carry anything. `code` and `requestId` are the
// portal's identifiers for the failure, not client data.
//
// A 429 is NOT here: it is "try again", a different thing from "something is
// wrong", and each layer words it for what it was doing.
import type { PortalError } from "./portal.ts";

export type FailureCause = "unauthorized" | "forbidden" | "unavailable" | "network" | "timeout" | "config" | "unexpected";

export const FAILURE_MESSAGE: Record<FailureCause, string> = {
  unauthorized: "The portal rejected CSS's key. Tell an admin; nothing from the portal will load until it is fixed.",
  forbidden: "CSS is not allowed to read this from the portal. Tell an admin.",
  unavailable: "The portal is unavailable right now. Tell an admin if it carries on.",
  network: "Could not reach the portal. Check the connection, then tell an admin if it carries on.",
  timeout: "The portal took too long to answer. Tell an admin if it carries on.",
  config: "CSS is not set up to reach the portal. Tell an admin.",
  unexpected: "The portal sent something CSS did not expect. Tell an admin.",
};

export function failureCause(error: PortalError): FailureCause {
  switch (error.kind) {
    case "unauthorized":
      return "unauthorized";
    case "forbidden":
      return "forbidden";
    case "unavailable":
      return "unavailable";
    case "network":
      return "network";
    case "timeout":
      return "timeout";
    case "config":
      return "config";
    default:
      // not_found, conflict, an unexpected status, a body of the wrong shape,
      // or a 400 the caller did not expect.
      return "unexpected";
  }
}

export interface FailureDetail {
  cause: FailureCause;
  message: string;
  code: string | null;
  requestId: string | null;
}

export function describeFailure(error: PortalError): FailureDetail {
  const cause = failureCause(error);
  return { cause, message: FAILURE_MESSAGE[cause], code: error.code, requestId: error.requestId };
}
