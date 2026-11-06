import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assignmentDescription,
  assignmentTitle,
  buildTaskBody,
  complaintDeepLink,
  isAssignmentPriority,
  type AssignmentCase,
} from "./assignments.ts";
import { stripSurroundingQuotes } from "./staffPortal.ts";

const CASE: AssignmentCase = {
  id: "11111111-2222-4333-8444-555555555555",
  subject: "Wrong amount charged on my plot",
  reference: "CASE-0007",
  description: "The receipt shows 250,000 but I paid 200,000.",
  kind: "ISSUE",
  typeText: "Wrong amount charged",
};

describe("assignmentTitle", () => {
  it("is 'Dispute: <subject> (<reference>)'", () => {
    assert.equal(assignmentTitle(CASE), "Dispute: Wrong amount charged on my plot (CASE-0007)");
  });

  it("falls back when the subject is blank", () => {
    assert.equal(assignmentTitle({ subject: "   ", reference: "CASE-1" }), "Dispute: (no subject) (CASE-1)");
  });
});

describe("assignmentDescription", () => {
  it("leads with the reference, kind and type, then the complaint's own text", () => {
    assert.equal(
      assignmentDescription(CASE),
      "Complaint CASE-0007 (ISSUE, Wrong amount charged), assigned from CSS.\n\nThe receipt shows 250,000 but I paid 200,000.",
    );
  });

  it("omits the type when there is none and the body when it is blank", () => {
    assert.equal(
      assignmentDescription({ ...CASE, typeText: null, description: "   " }),
      "Complaint CASE-0007 (ISSUE), assigned from CSS.",
    );
  });
});

describe("complaintDeepLink", () => {
  it("joins the origin and encodes the id; trims a trailing slash", () => {
    assert.equal(
      complaintDeepLink("https://frontdesk.example.com/", CASE.id),
      `https://frontdesk.example.com/complaints/${CASE.id}`,
    );
  });

  it("is null when no origin is configured (sourceUrl is then omitted)", () => {
    assert.equal(complaintDeepLink(null, CASE.id), null);
    assert.equal(complaintDeepLink("", CASE.id), null);
  });
});

describe("buildTaskBody", () => {
  it("builds the full body with source, sourceRef, sourceUrl and priority", () => {
    const body = buildTaskBody({
      caseInfo: CASE,
      assigneeEmail: "ada@gel.test",
      idempotencyKey: "key-abc",
      publicOrigin: "http://localhost:3000",
      priority: "High",
    });
    assert.deepEqual(body, {
      idempotencyKey: "key-abc",
      assigneeEmail: "ada@gel.test",
      title: "Dispute: Wrong amount charged on my plot (CASE-0007)",
      description: "Complaint CASE-0007 (ISSUE, Wrong amount charged), assigned from CSS.\n\nThe receipt shows 250,000 but I paid 200,000.",
      source: "css",
      sourceRef: CASE.id,
      sourceUrl: `http://localhost:3000/complaints/${CASE.id}`,
      priority: "High",
    });
  });

  it("omits sourceUrl and priority when not provided", () => {
    const body = buildTaskBody({
      caseInfo: CASE,
      assigneeEmail: "ada@gel.test",
      idempotencyKey: "key-xyz",
      publicOrigin: null,
      priority: null,
    });
    assert.equal("sourceUrl" in body, false);
    assert.equal("priority" in body, false);
    assert.equal(body.source, "css");
    assert.equal(body.sourceRef, CASE.id);
  });
});

describe("isAssignmentPriority", () => {
  it("accepts the four priorities and rejects anything else", () => {
    assert.ok(isAssignmentPriority("Urgent"));
    assert.ok(!isAssignmentPriority("urgent"));
    assert.ok(!isAssignmentPriority("Critical"));
  });
});

describe("stripSurroundingQuotes", () => {
  it("removes one matching pair of surrounding quotes and trims", () => {
    assert.equal(stripSurroundingQuotes('"abc.def"'), "abc.def");
    assert.equal(stripSurroundingQuotes("'abc.def'"), "abc.def");
    assert.equal(stripSurroundingQuotes('  "abc"  '), "abc");
  });

  it("leaves an unquoted or half-quoted value alone (bar trimming)", () => {
    assert.equal(stripSurroundingQuotes("abc.def"), "abc.def");
    assert.equal(stripSurroundingQuotes('"abc'), '"abc');
    assert.equal(stripSurroundingQuotes('a"b'), 'a"b');
  });
});
