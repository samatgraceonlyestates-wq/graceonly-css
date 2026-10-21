import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveName } from "./nameResolution.ts";
import type { RosterName } from "./rosterMatch.ts";

const pool: RosterName[] = [
  { id: "1", name: "Divine Mike", department: "Front desk" },
  { id: "2", name: "Peter Obi", department: null },
  { id: "3", name: "Ada Okafor", department: "Legal" },
  { id: "4", name: "Ada Okafor", department: "Finance" },
];
const input = (name: string, extra: { personId?: string | null; confirmNew?: boolean } = {}) => ({ name, personId: null, confirmNew: false, ...extra });

describe("resolveName: the ONE name rule (arrivals and the movement approver)", () => {
  it("an exact match is the same person, whatever the case or spacing", () => {
    const r = resolveName(input("  divine   MIKE "), pool);
    assert.deepEqual(r.kind === "person" ? r.person.id : null, "1");
  });

  it("a close name is a QUESTION, with the existing person offered; confirming makes a new one", () => {
    const ask = resolveName(input("Divine Mikel"), pool);
    assert.equal(ask.kind, "confirm");
    assert.deepEqual(ask.kind === "confirm" ? ask.candidates.map((c) => c.name) : [], ["Divine Mike"]);
    const made = resolveName(input("Divine Mikel", { confirmNew: true }), pool);
    assert.deepEqual(made, { kind: "create", name: "Divine Mikel" });
  });

  it("a name nobody is near is a new person, with its capitalisation exactly as typed", () => {
    assert.deepEqual(resolveName(input("  grace   nkem "), pool), { kind: "create", name: "grace nkem" });
    assert.deepEqual(resolveName(input("van der Merwe"), pool), { kind: "create", name: "van der Merwe" });
  });

  it("two people of one name are ambiguous unless she picked one", () => {
    const r = resolveName(input("Ada Okafor"), pool);
    assert.equal(r.kind, "problem");
    const picked = resolveName(input("Ada Okafor", { personId: "4" }), pool);
    assert.deepEqual(picked.kind === "person" ? picked.person.department : null, "Finance");
  });

  it("a picked person is honoured only while the name still IS theirs", () => {
    const edited = resolveName(input("Grace Nkem", { personId: "1" }), pool);
    assert.equal(edited.kind, "create");
  });

  it("refuses an empty or over-long name", () => {
    assert.equal(resolveName(input("   "), pool).kind, "problem");
    assert.equal(resolveName(input("x".repeat(101)), pool).kind, "problem");
  });
});
