// SERVER-ONLY (it uses portal.ts, which throws in a browser). The name lookup
// for screen 04: one search per submit, never per keystroke. The portal allows
// 20 searches per key per minute, so the desk types a name and submits.
//
// Nothing about a client is logged, cached or written anywhere here: the
// response goes straight into classifySearch and back to the caller.
import { searchClients } from "./portal.ts";
import { classifySearch, GUIDANCE_MESSAGE, type VisitSearchOutcome } from "./visitSearch.ts";

export async function lookupVisitor(rawQuery: string): Promise<VisitSearchOutcome> {
  const query = rawQuery.trim();

  // An empty submit is guidance, not a request: it would only spend one of
  // the 20 searches per minute to be told the same thing. Every other rule
  // (too short, no letters, too long) stays the portal's to decide.
  if (query === "") return { kind: "guidance", reason: "empty", message: GUIDANCE_MESSAGE.empty };

  return classifySearch(query, await searchClients(query));
}
