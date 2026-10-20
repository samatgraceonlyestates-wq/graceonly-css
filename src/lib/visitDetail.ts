// SERVER-ONLY (it uses portal.ts, which throws in a browser). Loads one client
// for screen 05: the summary, the documents and the release-check.
//
// PARALLEL, on purpose. The id comes from a search the desk has just run, so an
// unknown id is the rare case, and the three calls are independent, so asking
// one after another would triple the wait for the common case. What parallel
// costs is on failure only: a bad id or a failing portal spends all three calls
// instead of one. A load that works costs the same either way: 2 from the
// shared summary + documents bucket (60 a minute, so about 30 loads) and 1 from
// release-check's own (30 a minute). Each part keeps its own outcome, so a 429
// on one never hides the others.
//
// Nothing about a client is logged, cached or written: the responses go
// straight into classifyVisitDetail and back to the caller.
import { getClientDocuments, getClientSummary, getReleaseCheck } from "./portal.ts";
import { classifyVisitDetail, NOT_FOUND_MESSAGE, type VisitDetailState } from "./visitDetailState.ts";

export async function loadVisitDetail(rawClientId: string): Promise<VisitDetailState> {
  const clientId = rawClientId.trim();

  // Nothing to look up. The portal would 404 it anyway; do not spend three calls.
  if (clientId === "") return { kind: "not_found", message: NOT_FOUND_MESSAGE };

  const [summary, documents, release] = await Promise.all([
    getClientSummary(clientId),
    getClientDocuments(clientId),
    getReleaseCheck(clientId),
  ]);

  return classifyVisitDetail(clientId, summary, documents, release);
}
