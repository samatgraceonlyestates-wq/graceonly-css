// Run with `npm test`. Document handovers: the gate answers, the non-client refusal, corrections
// that append, and the migrations' append-only triggers. An in-memory store and a stubbed
// release-check: no database, no portal.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  assembleHandovers,
  GATE_ANSWER_TEXT,
  HANDOVER_DOCUMENTS,
  HANDOVER_MESSAGES,
  judgeRelease,
  recordHandover,
  withdrawHandover,
  type HandoverDeps,
  type HandoverStore,
  type HandoverTx,
  type HandoverVisit,
  type NewHandover,
  type RecordHandoverInput,
} from "./handovers.ts";
import { DOCUMENT_LABELS, DOCUMENT_TYPES, type PortalErrorKind, type PortalResult, type ReleaseCheck } from "./portal.ts";

const DESK = "00000000-0000-4000-8000-0000000000d1";
const CLIENT = "3f1c2d4e-5a6b-4c7d-8e9f-0a1b2c3d4e5f";
const VISIT = "00000000-0000-4000-8000-00000000a001";
const VISITOR_VISIT = "00000000-0000-4000-8000-00000000a002";
const PURCHASE = "p-1";

// ---- release-check answers, as portal.ts returns them
const gateOff: PortalResult<ReleaseCheck> = {
  ok: true,
  status: 409,
  requestId: "req-off",
  data: { gate: "not_active", code: "GATE_NOT_ACTIVE", message: "The document gate is not active." },
};
const failed = (kind: PortalErrorKind, requestId: string | null = "req-fail"): PortalResult<ReleaseCheck> => ({
  ok: false,
  error: { kind, status: kind === "network" ? null : 503, code: null, message: "x", retryAfterSeconds: null, requestId, body: null },
});
const entry = (documentType: string, typeIsGated: boolean, allowed: boolean, reason: "PAID" | "OUTSTANDING" | "NOT_GATED_TYPE" | "UNKNOWN") => ({
  documentType: documentType as (typeof DOCUMENT_TYPES)[number],
  label: documentType,
  typeIsGated,
  allowed,
  reason,
  outstandingKobo: reason === "OUTSTANDING" ? 5000 : null,
});
const checked = (byType: ReturnType<typeof entry>[], clientId = CLIENT): PortalResult<ReleaseCheck> => ({
  ok: true,
  status: 200,
  requestId: "req-on",
  data: {
    gate: "active",
    answer: {
      clientId,
      portalGateEnabled: true,
      purchases: [
        { purchaseId: PURCHASE, kind: "PLOT", label: "Plot T-1", estate: "T", estateName: "Test", status: "ACTIVE", gatedDocumentsAllowed: false, byType },
      ],
      summary: { livePurchaseCount: 1, gatedDocumentsAllowedCount: 0, gatedDocumentsRefusedCount: 0, endedPurchaseCount: 0, allLiveAllowed: false },
      evaluatedAt: "2026-10-26T10:00:00Z",
    },
  },
});
const allowing = checked([entry("DEED_OF_ASSIGNMENT", true, true, "PAID"), entry("RECEIPT", false, true, "NOT_GATED_TYPE")]);
const blocking = checked([entry("DEED_OF_ASSIGNMENT", true, false, "OUTSTANDING"), entry("RECEIPT", false, true, "NOT_GATED_TYPE")]);

// ---- an in-memory store: INSERT only, like the real tables
class MemoryStore implements HandoverStore {
  visits = new Map<string, HandoverVisit>([
    [VISIT, { id: VISIT, name: "Kingsley Eze", clientId: CLIENT, voidedAt: null }],
    [VISITOR_VISIT, { id: VISITOR_VISIT, name: "Tunde Afolabi", clientId: null, voidedAt: null }],
  ]);
  handovers: (NewHandover & { releasedAt: Date })[] = [];
  corrections: { id: string; handoverId: string; reason: string; correctedBy: string; correctedAt: Date }[] = [];
  audits: unknown[] = [];
  clock = Date.parse("2026-10-26T10:00:00Z");

  async visit(id: string) {
    return this.visits.get(id) ?? null;
  }

  async transaction<T>(work: (tx: HandoverTx) => Promise<T>): Promise<T> {
    return work(memoryTx(this));
  }
}

function memoryTx(store: MemoryStore): HandoverTx {
  return {
    async lockVisit() {},
    async findVisit(id) {
      return store.visits.get(id) ?? null;
    },
    async lockHandover() {},
    async findHandover(id) {
      const handover = store.handovers.find((candidate) => candidate.id === id);
      if (!handover) return null;
      const correction = store.corrections.find((candidate) => candidate.handoverId === id);
      return {
        id,
        visitId: handover.visitId,
        releasedAt: handover.releasedAt,
        withdrawnAt: correction?.correctedAt ?? null,
        withdrawnByName: correction ? "Joy Akpan" : null,
        replacedById: store.handovers.find((candidate) => candidate.replacesId === id)?.id ?? null,
      };
    },
    async insertHandover(handover) {
      store.clock += 60_000;
      store.handovers.push({ ...handover, releasedAt: new Date(store.clock) });
    },
    async insertCorrection(correction) {
      // handover_correction_once_key, as the database would refuse it.
      if (store.corrections.some((candidate) => candidate.handoverId === correction.handoverId)) throw new Error("handover_correction_once_key");
      store.clock += 60_000;
      store.corrections.push({ ...correction, correctedAt: new Date(store.clock) });
    },
    async audit(entry) {
      store.audits.push(entry);
    },
  };
}

let ids = 0;
function deps(store: MemoryStore, answer: PortalResult<ReleaseCheck>, calls: string[] = []): HandoverDeps {
  return {
    store,
    actorId: DESK,
    newId: () => `00000000-0000-4000-8000-${String(++ids).padStart(12, "0")}`,
    releaseCheck: async (clientId) => {
      calls.push(clientId);
      return answer;
    },
  };
}

const input = (over: Partial<RecordHandoverInput> = {}): RecordHandoverInput => ({
  visitId: VISIT,
  purchaseId: PURCHASE,
  quantities: { DEED_OF_ASSIGNMENT: "1" },
  note: "",
  acknowledgeUnverified: false,
  replacesHandoverId: "",
  ...over,
});

describe("the documents offered are the portal's six slots, with its labels", () => {
  it("matches portal.ts exactly, in order", () => {
    assert.deepEqual(
      HANDOVER_DOCUMENTS.map((document) => document.code),
      [...DOCUMENT_TYPES],
    );
    for (const document of HANDOVER_DOCUMENTS) assert.equal(document.label, DOCUMENT_LABELS[document.code]);
  });
});

describe("judgeRelease: silence is not permission", () => {
  const ask = { clientId: CLIENT, purchaseId: PURCHASE, documents: ["DEED_OF_ASSIGNMENT"] };
  it("gate off is GATE_OFF, never allowed", () => {
    assert.deepEqual(judgeRelease(gateOff, ask), { kind: "answer", answer: "GATE_OFF", requestId: "req-off", refused: [] });
  });
  it("any failure to ask is UNAVAILABLE, with the portal's request id when it gave one", () => {
    for (const kind of ["network", "timeout", "rate_limited", "unavailable", "unauthorized", "unexpected", "config"] as const) {
      const judged = judgeRelease(failed(kind), ask);
      assert.ok(judged.kind === "answer" && judged.answer === "UNAVAILABLE", kind);
    }
  });
  it("an answer about someone else is UNAVAILABLE", () => {
    const judged = judgeRelease(checked([entry("DEED_OF_ASSIGNMENT", true, true, "PAID")], "someone-else"), ask);
    assert.equal(judged.kind === "answer" && judged.answer, "UNAVAILABLE");
  });
  it("allowed, refused, not gated, and what the answer leaves out", () => {
    assert.equal((judgeRelease(allowing, ask) as { answer: string }).answer, "CHECKED_ALLOWED");
    const blocked = judgeRelease(blocking, ask);
    assert.ok(blocked.kind === "answer" && blocked.answer === "CHECKED_BLOCKED");
    assert.deepEqual(blocked.kind === "answer" && blocked.refused, [{ code: "DEED_OF_ASSIGNMENT", label: "Deed of Assignment", why: "Documentation fee outstanding" }]);
    assert.equal((judgeRelease(blocking, { ...ask, documents: ["RECEIPT"] }) as { answer: string }).answer, "NOT_GATED");
    assert.equal((judgeRelease(allowing, { ...ask, documents: ["SURVEY_PLAN"] }) as { answer: string }).answer, "CHECKED_BLOCKED", "a document the answer does not mention");
    assert.equal((judgeRelease(allowing, { ...ask, purchaseId: "p-unknown" }) as { answer: string }).answer, "CHECKED_BLOCKED", "a purchase the answer does not include");
    assert.deepEqual(judgeRelease(allowing, { ...ask, purchaseId: null }), { kind: "needs_purchase" });
  });
  it("only an actual answer counts as verified", () => {
    assert.deepEqual(
      Object.entries(GATE_ANSWER_TEXT).filter(([, text]) => text.verified).map(([answer]) => answer).sort(),
      ["CHECKED_ALLOWED", "CHECKED_BLOCKED", "NOT_GATED"],
    );
  });
});

describe("recordHandover", () => {
  it("THE GATE OFF: asks first, writes nothing; confirmed, it is recorded as GATE_OFF", async () => {
    const store = new MemoryStore();
    const asked = await recordHandover(input(), deps(store, gateOff));
    assert.ok(!asked.ok && asked.kind === "unverified" && asked.answer === "GATE_OFF");
    assert.match(!asked.ok ? asked.message : "", /NOBODY can verify this release\. Silence is not permission\./);
    assert.equal(store.handovers.length, 0);
    const recorded = await recordHandover(input({ acknowledgeUnverified: true }), deps(store, gateOff));
    assert.ok(recorded.ok && recorded.answer === "GATE_OFF");
    assert.match(recorded.ok ? recorded.message : "", /^Recorded as NOT VERIFIED\. NOBODY VERIFIED THIS RELEASE/);
    assert.equal(store.handovers[0]!.gateAnswer, "GATE_OFF");
    assert.equal(store.handovers[0]!.gateRequestId, "req-off");
    assert.equal(store.handovers[0]!.releasedBy, DESK);
    assert.equal(store.handovers[0]!.clientId, CLIENT);
    assert.deepEqual(store.handovers[0]!.items, [{ code: "DEED_OF_ASSIGNMENT", quantity: 1 }]);
  });

  it("THE GATE ALLOWING: recorded as CHECKED_ALLOWED, no confirmation needed", async () => {
    const store = new MemoryStore();
    const recorded = await recordHandover(input(), deps(store, allowing));
    assert.ok(recorded.ok && recorded.answer === "CHECKED_ALLOWED");
    assert.equal(store.handovers[0]!.purchaseId, PURCHASE);
  });

  it("a non-gated document is NOT_GATED", async () => {
    const store = new MemoryStore();
    const recorded = await recordHandover(input({ quantities: { RECEIPT: "2" } }), deps(store, blocking));
    assert.ok(recorded.ok && recorded.answer === "NOT_GATED");
  });

  it("THE GATE BLOCKING STOPS IT: nothing recorded, even when she confirms", async () => {
    const store = new MemoryStore();
    for (const acknowledgeUnverified of [false, true]) {
      const result = await recordHandover(input({ quantities: { DEED_OF_ASSIGNMENT: "1", RECEIPT: "1" }, acknowledgeUnverified }), deps(store, blocking));
      assert.ok(!result.ok && result.kind === "blocked");
      assert.deepEqual(!result.ok && result.kind === "blocked" ? result.refused.map((refusal) => refusal.label) : [], ["Deed of Assignment"]);
    }
    assert.equal(store.handovers.length, 0);
    assert.equal(store.audits.length, 0);
  });

  it("THE PORTAL UNAVAILABLE: asks first; confirmed, it is recorded as UNAVAILABLE", async () => {
    const store = new MemoryStore();
    const asked = await recordHandover(input(), deps(store, failed("network", null)));
    assert.ok(!asked.ok && asked.kind === "unverified" && asked.answer === "UNAVAILABLE");
    const recorded = await recordHandover(input({ acknowledgeUnverified: true, purchaseId: "" }), deps(store, failed("unavailable")));
    assert.ok(recorded.ok && recorded.answer === "UNAVAILABLE");
    assert.equal(store.handovers[0]!.gateRequestId, "req-fail");
    assert.equal(store.handovers[0]!.purchaseId, null, "unknown when the portal could not list it");
  });

  it("A NON-CLIENT IS REFUSED, before the portal is asked", async () => {
    const store = new MemoryStore();
    const calls: string[] = [];
    const result = await recordHandover(input({ visitId: VISITOR_VISIT, acknowledgeUnverified: true }), deps(store, allowing, calls));
    assert.deepEqual(result, { ok: false, kind: "refused", message: HANDOVER_MESSAGES.nonClient });
    assert.equal(calls.length, 0, "no portal call for a non-client");
    assert.equal(store.handovers.length, 0);
  });

  it("a removed visit is refused; the gate on with no purchase asks for one", async () => {
    const store = new MemoryStore();
    store.visits.get(VISIT)!.voidedAt = new Date();
    assert.deepEqual(await recordHandover(input(), deps(store, allowing)), { ok: false, kind: "refused", message: HANDOVER_MESSAGES.removed });
    store.visits.get(VISIT)!.voidedAt = null;
    assert.deepEqual(await recordHandover(input({ purchaseId: "" }), deps(store, allowing)), { ok: false, kind: "refused", message: HANDOVER_MESSAGES.needsPurchase });
  });

  it("needs at least one document and sensible quantities", async () => {
    const store = new MemoryStore();
    const noCall = deps(store, allowing);
    assert.deepEqual(await recordHandover(input({ quantities: { DEED_OF_ASSIGNMENT: "0" } }), noCall), {
      ok: false,
      kind: "refused",
      message: HANDOVER_MESSAGES.nothingChosen,
    });
    assert.equal((await recordHandover(input({ quantities: { DEED_OF_ASSIGNMENT: "1.5" } }), noCall)).ok, false);
    assert.equal((await recordHandover(input({ quantities: { DEED_OF_ASSIGNMENT: "21" } }), noCall)).ok, false);
    assert.equal((await recordHandover(input({ quantities: { OTHER: "1" } }), noCall)).ok, false, "OTHER is not offered");
  });
});

describe("corrections append: the original stays and is shown with its correction", () => {
  it("withdraw needs a reason, appends one row, and a second withdrawal is refused", async () => {
    const store = new MemoryStore();
    const recorded = await recordHandover(input({ acknowledgeUnverified: true }), deps(store, gateOff));
    assert.ok(recorded.ok);
    const id = recorded.ok ? recorded.handoverId : "";
    assert.deepEqual(await withdrawHandover({ handoverId: id, reason: " " }, deps(store, gateOff)), { ok: false, message: HANDOVER_MESSAGES.needsReason });
    assert.equal((await withdrawHandover({ handoverId: id, reason: "two copies, not one" }, deps(store, gateOff))).ok, true);
    assert.equal(store.handovers.length, 1, "the original is untouched");
    assert.equal(store.corrections.length, 1);
    const again = await withdrawHandover({ handoverId: id, reason: "again" }, deps(store, gateOff));
    assert.deepEqual(again, { ok: false, message: "That record was already withdrawn by Joy Akpan. Reload the page." });
  });

  it("a replacement names the withdrawn record, runs the gate again, and replaces it once", async () => {
    const store = new MemoryStore();
    const first = await recordHandover(input({ acknowledgeUnverified: true }), deps(store, gateOff));
    const firstId = first.ok ? first.handoverId : "";
    // Not withdrawn yet: refused.
    const early = await recordHandover(input({ acknowledgeUnverified: true, replacesHandoverId: firstId }), deps(store, gateOff));
    assert.deepEqual(early, { ok: false, kind: "refused", message: "Withdraw the wrong record first, with a reason, then record the right one." });
    await withdrawHandover({ handoverId: firstId, reason: "two copies, not one" }, deps(store, gateOff));
    // The gate is asked again for the replacement: a refusal now stops it.
    const blocked = await recordHandover(input({ replacesHandoverId: firstId }), deps(store, blocking));
    assert.ok(!blocked.ok && blocked.kind === "blocked");
    const second = await recordHandover(input({ quantities: { DEED_OF_ASSIGNMENT: "2" }, replacesHandoverId: firstId }), deps(store, allowing));
    assert.ok(second.ok && second.answer === "CHECKED_ALLOWED");
    assert.equal(store.handovers[1]!.replacesId, firstId);
    const twice = await recordHandover(input({ replacesHandoverId: firstId }), deps(store, allowing));
    assert.deepEqual(twice, { ok: false, kind: "refused", message: "That record has already been replaced. Reload the page." });
  });

  it("the list always carries a withdrawn record's correction, and the links both ways", () => {
    const at = (minute: number) => new Date(Date.UTC(2026, 9, 26, 10, minute));
    const views = assembleHandovers(
      [
        { id: "b", releasedAt: at(5), releasedByName: "Joy", purchaseId: PURCHASE, gateAnswer: "CHECKED_ALLOWED", gateRequestId: null, note: null, replacesId: "a" },
        { id: "a", releasedAt: at(1), releasedByName: "Joy", purchaseId: PURCHASE, gateAnswer: "GATE_OFF", gateRequestId: null, note: null, replacesId: null },
      ],
      [
        { handoverId: "a", code: "DEED_OF_ASSIGNMENT", quantity: 1 },
        { handoverId: "b", code: "RECEIPT", quantity: 1 },
        { handoverId: "b", code: "DEED_OF_ASSIGNMENT", quantity: 2 },
      ],
      [{ handoverId: "a", reason: "two copies, not one", correctedAt: at(3), correctedByName: "Kemi" }],
    );
    assert.deepEqual(views.map((view) => view.id), ["a", "b"], "oldest first: the original, then its replacement");
    assert.equal(views[0]!.correction?.reason, "two copies, not one");
    assert.deepEqual(views[0]!.replacedBy, { id: "b", releasedAt: at(5) });
    assert.deepEqual(views[1]!.replaces, { id: "a", releasedAt: at(1), reason: "two copies, not one" });
    assert.deepEqual(views[1]!.items.map((item) => item.code), ["DEED_OF_ASSIGNMENT", "RECEIPT"], "in the portal's slot order");
    assert.equal(views[1]!.correction, null);
  });
});

describe("the append-only triggers (migrations)", () => {
  const dir = join(import.meta.dirname, "..", "..", "db", "migrations");
  const all = readdirSync(dir)
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .map((name) => readFileSync(join(dir, name), "utf8").replace(/--.*$/gm, ""))
    .join("\n");

  it("handover, handover_item and handover_correction refuse UPDATE, DELETE and TRUNCATE", () => {
    for (const table of ["handover", "handover_item", "handover_correction"]) {
      assert.match(all, new RegExp(`CREATE TRIGGER ${table}_no_row_change\\s+BEFORE UPDATE OR DELETE ON ${table}\\s+FOR EACH ROW EXECUTE PROCEDURE forbid_change\\(\\)`), table);
      assert.match(all, new RegExp(`CREATE TRIGGER ${table}_no_truncate\\s+BEFORE TRUNCATE ON ${table}\\s+FOR EACH STATEMENT EXECUTE PROCEDURE forbid_change\\(\\)`), table);
    }
  });

  it("no migration drops, disables or replaces them, or redefines forbid_change", () => {
    assert.doesNotMatch(all, /DROP TRIGGER/i);
    assert.doesNotMatch(all, /DISABLE TRIGGER/i);
    assert.equal((all.match(/CREATE (OR REPLACE )?FUNCTION forbid_change/gi) ?? []).length, 1);
  });

  it("the store can only INSERT into them", () => {
    const store = readFileSync(join(import.meta.dirname, "handoverStore.ts"), "utf8");
    assert.doesNotMatch(store, /\b(UPDATE|DELETE FROM|TRUNCATE)\s+handover/i);
  });
});
