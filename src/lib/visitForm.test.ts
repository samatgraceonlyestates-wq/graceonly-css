// Run with `npm test`. What screen 04 decides the lookup came to, from what happened on it.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ClientCandidate } from "./portal.ts";
import { NOT_LISTED, personFor } from "./visitForm.ts";
import { planCheckIn } from "./visits.ts";
import type { VisitSearchState } from "./visitSearch.ts";

const ID = "3f1c2d4e-5a6b-4c7d-8e9f-0a1b2c3d4e5f";
const candidate = { clientId: ID, displayName: "Chidinma Okafor" } as ClientCandidate;
const candidates: VisitSearchState = { kind: "candidates", query: "Chidinma Okafor", candidates: [candidate], truncated: false };
const failure: VisitSearchState = { kind: "failure", cause: "network", message: "Could not reach the client records.", code: null, requestId: null };
const limited: VisitSearchState = { kind: "rate_limited", message: "Too many searches just now.", retryAfterSeconds: 60 };

const client = (search: VisitSearchState, picked: string | null = null, typedName = "Chidinma Okafor") =>
  personFor({ isClient: true, typedName, search, searchedName: "Chidinma Okafor", picked });

describe("personFor", () => {
  it("a non-client type is NOT_LOOKED_UP once a name is typed", () => {
    assert.deepEqual(personFor({ isClient: false, typedName: "DHL Courier", search: { kind: "idle" }, searchedName: "", picked: null }), {
      kind: "visitor",
      lookup: "NOT_LOOKED_UP",
      name: "DHL Courier",
    });
    assert.equal(personFor({ isClient: false, typedName: "", search: { kind: "idle" }, searchedName: "", picked: null }), null);
  });

  it("a Client not looked up yet is nobody: the form says to look them up", () => {
    assert.equal(client({ kind: "idle" }), null);
    assert.equal(client({ kind: "guidance", reason: "too_short", message: "Type more." }), null);
  });

  it("a FAILED search lets her go on, as PORTAL_UNAVAILABLE, under the name she searched for", () => {
    assert.deepEqual(client(failure), { kind: "visitor", lookup: "PORTAL_UNAVAILABLE", name: "Chidinma Okafor" });
    assert.deepEqual(client(limited), { kind: "visitor", lookup: "PORTAL_UNAVAILABLE", name: "Chidinma Okafor" });
  });

  it("nobody found, or none of these, is NO_MATCH", () => {
    assert.deepEqual(client({ kind: "no_match", query: "Chidinma Okafor" }), { kind: "visitor", lookup: "NO_MATCH", name: "Chidinma Okafor" });
    assert.deepEqual(client(candidates, NOT_LISTED), { kind: "visitor", lookup: "NO_MATCH", name: "Chidinma Okafor" });
  });

  it("a picked candidate is MATCHED, with the portal's name; nothing picked is nobody yet", () => {
    assert.deepEqual(client(candidates, ID), { kind: "client", lookup: "MATCHED", clientId: ID, name: "Chidinma Okafor" });
    assert.equal(client(candidates), null);
  });

  it("results for another name never stand behind a new person", () => {
    assert.equal(client(failure, null, "Someone Else"), null);
    assert.equal(client(candidates, ID, "Chidinma"), null);
  });

  it("what it decides is what the server accepts: PORTAL_UNAVAILABLE checks in with consent", () => {
    const person = client(failure)!;
    const planned = planCheckIn({
      visitorType: "CLIENT",
      reason: "INQUIRY",
      toSee: "",
      lookup: person.lookup,
      clientId: "",
      clientName: "",
      name: person.name,
      phone: "",
      organisation: "",
      consent: true,
      sameVisitorId: "",
    });
    assert.ok(planned.ok && planned.plan.kind === "visitor" && planned.plan.lookupOutcome === "PORTAL_UNAVAILABLE");
  });
});
