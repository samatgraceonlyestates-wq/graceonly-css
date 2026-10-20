// SERVER-ONLY (it uses portal.ts, which throws in a browser). One summary call
// for the picked candidate's result card: it costs 1 from the shared 60-a-minute
// summary + documents bucket, so it runs on a pick, not on every render.
//
// Nothing about the client is logged, cached or written.
import { getClientSummary } from "./portal.ts";
import { classifyBrief, type VisitorBriefState } from "./visitorBriefState.ts";
import { NOT_FOUND_MESSAGE } from "./visitDetailState.ts";

export async function loadVisitorBrief(rawClientId: string): Promise<VisitorBriefState> {
  const clientId = rawClientId.trim();
  if (clientId === "") return { kind: "not_found", message: NOT_FOUND_MESSAGE };
  return classifyBrief(clientId, await getClientSummary(clientId));
}
