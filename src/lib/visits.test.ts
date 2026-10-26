// Run with `npm test`. The visitor log's rules against an in-memory VisitStore: no database.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { groupVisitDay, type VisitRow } from "./visitLog.ts";
import {
  checkIn,
  checkOut,
  closeDay,
  correctVisit,
  identityKey,
  MESSAGES,
  planCheckIn,
  type AuditEntry,
  type CheckInInput,
  type CloseReason,
  type LookupOutcome,
  type NewVisit,
  type NewVisitor,
  type VisitDeps,
  type VisitStore,
  type VisitTx,
} from "./visits.ts";
import { PHONE_MESSAGE } from "./phoneNumber.ts";

const DESK = "00000000-0000-4000-8000-0000000000d1";
const DESK_NAME = "Joy Akpan";
const CLIENT = "3f1c2d4e-5a6b-4c7d-8e9f-0a1b2c3d4e5f";
// 26 Oct 2026, 11:00 in Lagos (UTC+1).
const NOW = new Date("2026-10-26T10:00:00Z");

interface StoredVisit {
  id: string;
  updatedAt: number;
  visitorTypeCode: string;
  reasonCode: string;
  clientId: string | null;
  clientNameLogged: string | null;
  visitorId: string | null;
  lookupOutcome: LookupOutcome;
  toSee: string | null;
  checkedInAt: Date;
  checkedInBy: string;
  checkedOutAt: Date | null;
  checkedOutBy: string | null;
  closeReason: CloseReason | null;
  correctedAt: Date | null;
  correctedBy: string | null;
  correctionReason: string | null;
  voidedAt: Date | null;
}

interface StoredVisitor {
  id: string;
  displayName: string;
  phone: string | null;
  organisation: string | null;
  consentAt: Date;
}

class MemoryStore implements VisitStore {
  visits: StoredVisit[] = [];
  visitors: StoredVisitor[] = [];
  audits: AuditEntry[] = [];
  locks: string[] = [];
  clock = NOW.getTime();
  /** Run between the read and the write of the next transaction: "someone else got there first". */
  interleave: (() => void) | null = null;

  version(visit: StoredVisit) {
    return String(visit.updatedAt);
  }

  touch(visit: StoredVisit) {
    this.clock += 1;
    visit.updatedAt = this.clock;
  }

  open(identity: { clientId?: string | null; visitorId?: string | null }, exceptId?: string) {
    return this.visits
      .filter(
        (visit) =>
          visit.id !== exceptId &&
          visit.checkedOutAt === null &&
          visit.voidedAt === null &&
          ((identity.clientId && visit.clientId === identity.clientId) || (identity.visitorId && visit.visitorId === identity.visitorId)),
      )
      .sort((a, b) => a.checkedInAt.getTime() - b.checkedInAt.getTime())[0];
  }

  async transaction<T>(work: (tx: VisitTx) => Promise<T>): Promise<T> {
    const snapshot = structuredClone({ visits: this.visits, visitors: this.visitors, audits: this.audits });
    try {
      return await work(memoryTx(this));
    } catch (error) {
      Object.assign(this, snapshot);
      throw error;
    }
  }
}

function memoryTx(store: MemoryStore): VisitTx {
  return {
    async lockIdentity(key) {
      store.locks.push(key);
    },
    async lockVisit(id) {
      const visit = store.visits.find((candidate) => candidate.id === id);
      if (visit) store.locks.push(visit.clientId ? identityKey({ clientId: visit.clientId }) : identityKey({ visitorId: visit.visitorId! }));
      store.locks.push(`visit:${id}`);
    },
    async findVisit(id) {
      const visit = store.visits.find((candidate) => candidate.id === id);
      if (!visit) return null;
      const visitor = store.visitors.find((candidate) => candidate.id === visit.visitorId);
      const other = store.open({ clientId: visit.clientId, visitorId: visit.visitorId }, visit.id);
      const record = {
        id: visit.id,
        version: store.version(visit),
        name: visit.clientNameLogged ?? visitor!.displayName,
        clientId: visit.clientId,
        visitorId: visit.visitorId,
        visitorTypeCode: visit.visitorTypeCode,
        reasonCode: visit.reasonCode,
        toSee: visit.toSee,
        lookupOutcome: visit.lookupOutcome,
        checkedInAt: visit.checkedInAt,
        checkedOutAt: visit.checkedOutAt,
        closeReason: visit.closeReason,
        checkedOutByName: visit.checkedOutBy ? DESK_NAME : null,
        voidedAt: visit.voidedAt,
        phone: visitor?.phone ?? null,
        otherOpenSince: other?.checkedInAt ?? null,
      };
      if (store.interleave) {
        const run = store.interleave;
        store.interleave = null;
        run();
      }
      return record;
    },
    async openVisitOf(identity) {
      const visit = store.open(identity);
      return visit ? { id: visit.id, checkedInAt: visit.checkedInAt, checkedInByName: DESK_NAME } : null;
    },
    async visitorByPhone(phone, except = null) {
      const visitor = store.visitors.find((candidate) => candidate.phone === phone && candidate.id !== except);
      if (!visitor) return null;
      const last = store.visits.filter((visit) => visit.visitorId === visitor.id && visit.voidedAt === null).map((visit) => visit.checkedInAt.getTime());
      return { id: visitor.id, name: visitor.displayName, lastVisitAt: last.length ? new Date(Math.max(...last)) : null };
    },
    async insertVisitor(visitor: NewVisitor) {
      store.visitors.push({ id: visitor.id, displayName: visitor.displayName, phone: visitor.phone, organisation: visitor.organisation, consentAt: NOW });
    },
    async insertVisit(visit: NewVisit) {
      // The unique indexes of 017, as the database would refuse them.
      if (store.open({ clientId: visit.clientId, visitorId: visit.visitorId })) throw new Error("visit_one_open_per_*_key");
      store.clock += 1;
      store.visits.push({
        ...visit,
        updatedAt: store.clock,
        checkedInAt: NOW,
        checkedOutAt: null,
        checkedOutBy: null,
        closeReason: null,
        correctedAt: null,
        correctedBy: null,
        correctionReason: null,
        voidedAt: null,
      });
    },
    async checkOut({ id, actorId }) {
      const visit = store.visits.find((candidate) => candidate.id === id && candidate.checkedOutAt === null && candidate.voidedAt === null);
      if (!visit) return false;
      Object.assign(visit, { checkedOutAt: NOW, checkedOutBy: actorId, closeReason: "NORMAL" });
      store.touch(visit);
      return true;
    },
    async autoClose({ id, actorId }) {
      const visit = store.visits.find((candidate) => candidate.id === id && candidate.checkedOutAt === null && candidate.voidedAt === null);
      if (!visit) return null;
      Object.assign(visit, { checkedOutAt: NOW, checkedOutBy: actorId, closeReason: "AUTO_CLOSED" });
      store.touch(visit);
      return NOW;
    },
    async applyCorrection({ id, version, actorId, reason, correction }) {
      const visit = store.visits.find((candidate) => candidate.id === id);
      if (!visit || store.version(visit) !== version) return false;
      if (correction.kind === "restore" ? visit.voidedAt === null : visit.voidedAt !== null) return false;
      switch (correction.kind) {
        case "checkin":
          visit.checkedInAt = correction.checkedInAt;
          break;
        case "checkout":
          if (visit.checkedOutAt === null) return false;
          Object.assign(visit, { checkedOutAt: correction.checkedOutAt, closeReason: "NORMAL", checkedOutBy: visit.checkedOutBy ?? actorId });
          break;
        case "reopen":
          if (visit.checkedOutAt === null) return false;
          Object.assign(visit, { checkedOutAt: null, checkedOutBy: null, closeReason: null });
          break;
        case "reason":
          visit.reasonCode = correction.reasonCode;
          break;
        case "toSee":
          visit.toSee = correction.toSee;
          break;
        case "type":
          visit.visitorTypeCode = correction.visitorTypeCode;
          break;
        case "name":
          store.visitors.find((visitor) => visitor.id === correction.visitorId)!.displayName = correction.displayName;
          break;
        case "phone":
          store.visitors.find((visitor) => visitor.id === correction.visitorId)!.phone = correction.phone;
          break;
        case "void":
          visit.voidedAt = NOW;
          break;
        case "restore":
          visit.voidedAt = null;
          break;
      }
      Object.assign(visit, { correctedAt: NOW, correctedBy: actorId, correctionReason: reason });
      store.touch(visit);
      return true;
    },
    async audit(entry) {
      store.audits.push(entry);
    },
  };
}

let ids = 0;
const deps = (store: MemoryStore, now = NOW): VisitDeps => ({
  store,
  actorId: DESK,
  now,
  newId: () => `00000000-0000-4000-8000-${String(++ids).padStart(12, "0")}`,
});

const base: CheckInInput = {
  visitorType: "VISITOR",
  reason: "INQUIRY",
  toSee: "",
  lookup: "NOT_LOOKED_UP",
  clientId: "",
  clientName: "",
  name: "Bola Ade",
  phone: "",
  organisation: "",
  consent: true,
  sameVisitorId: "",
};
const client: CheckInInput = { ...base, visitorType: "CLIENT", lookup: "MATCHED", clientId: CLIENT, clientName: "Chidinma Okafor", name: "" };

async function checkedIn(store: MemoryStore, input: CheckInInput) {
  const result = await checkIn(input, deps(store));
  assert.equal(result.ok, true, result.ok ? "" : result.message);
  return result.ok ? result.visitId : "";
}

describe("planCheckIn: the outcome must be honest and consistent", () => {
  it("a non-client type is NOT_LOOKED_UP and nothing else", () => {
    assert.equal(planCheckIn(base).ok, true);
    for (const lookup of ["MATCHED", "NO_MATCH", "PORTAL_UNAVAILABLE"]) {
      assert.deepEqual(planCheckIn({ ...base, lookup }), { ok: false, message: MESSAGES.lookupGone, field: "lookup" }, lookup);
    }
  });

  it("a Client must have been looked up", () => {
    const result = planCheckIn({ ...base, visitorType: "CLIENT", lookup: "NOT_LOOKED_UP" });
    assert.deepEqual(result, { ok: false, message: MESSAGES.lookupFirst, field: "lookup" });
  });

  it("a MATCHED client carries a portal id (a UUID) and the name as the portal gave it", () => {
    const result = planCheckIn(client);
    assert.ok(result.ok && result.plan.kind === "client");
    if (result.ok && result.plan.kind === "client") {
      assert.equal(result.plan.clientId, CLIENT);
      assert.equal(result.plan.clientName, "Chidinma Okafor");
    }
    assert.equal(planCheckIn({ ...client, clientId: "client-1" }).ok, false, "not a UUID");
    assert.equal(planCheckIn({ ...client, clientName: "  " }).ok, false, "no name");
  });

  it("PORTAL_UNAVAILABLE and NO_MATCH are a Client logged as a visitor record, with consent", () => {
    for (const lookup of ["PORTAL_UNAVAILABLE", "NO_MATCH"] as const) {
      const result = planCheckIn({ ...base, visitorType: "CLIENT", lookup, name: "Mrs Okolo" });
      assert.ok(result.ok && result.plan.kind === "visitor" && result.plan.lookupOutcome === lookup && result.plan.visitorTypeCode === "CLIENT", lookup);
    }
  });

  it("a visitor needs a name and consent; the phone is normalised or refused", () => {
    assert.deepEqual(planCheckIn({ ...base, name: "  " }), { ok: false, message: MESSAGES.name, field: "name" });
    assert.deepEqual(planCheckIn({ ...base, consent: false }), { ok: false, message: MESSAGES.consent, field: "consent" });
    assert.deepEqual(planCheckIn({ ...base, phone: "803 123 4567" }), { ok: false, message: PHONE_MESSAGE, field: "phone" });
    const result = planCheckIn({ ...base, phone: "0803 123 4567", name: "  Bola   Ade ", toSee: "  Peter  Obi " });
    assert.ok(result.ok && result.plan.kind === "visitor");
    if (result.ok && result.plan.kind === "visitor") {
      assert.equal(result.plan.phone, "+2348031234567");
      assert.equal(result.plan.name, "Bola Ade");
      assert.equal(result.plan.toSee, "Peter Obi");
    }
  });

  it("refuses an unknown type, reason or outcome", () => {
    assert.equal(planCheckIn({ ...base, visitorType: "STAFF" }).ok, false);
    assert.equal(planCheckIn({ ...base, reason: "PARTY" }).ok, false);
    assert.equal(planCheckIn({ ...base, lookup: "MAYBE" }).ok, false);
  });
});

describe("checkIn", () => {
  it("a client: one visit, the snapshot name, MATCHED, who typed it, an audit row with no client data", async () => {
    const store = new MemoryStore();
    const id = await checkedIn(store, { ...client, toSee: "Peter Obi" });
    const [visit] = store.visits;
    assert.equal(visit!.id, id);
    assert.equal(visit!.clientId, CLIENT);
    assert.equal(visit!.clientNameLogged, "Chidinma Okafor");
    assert.equal(visit!.visitorId, null);
    assert.equal(visit!.lookupOutcome, "MATCHED");
    assert.equal(visit!.checkedInBy, DESK);
    assert.equal(visit!.toSee, "Peter Obi");
    assert.equal(store.visitors.length, 0, "a client gets no visitor row");
    assert.equal(store.audits.length, 1);
    assert.doesNotMatch(JSON.stringify(store.audits), /Chidinma|3f1c2d4e/, "no client name or portal id in the audit log");
  });

  it("PORTAL_UNAVAILABLE: check-in still works and says so", async () => {
    const store = new MemoryStore();
    await checkedIn(store, { ...base, visitorType: "CLIENT", lookup: "PORTAL_UNAVAILABLE", name: "Mrs Okolo", phone: "08031234567" });
    const [visit] = store.visits;
    assert.equal(visit!.lookupOutcome, "PORTAL_UNAVAILABLE");
    assert.equal(visit!.visitorTypeCode, "CLIENT");
    assert.equal(visit!.clientId, null);
    assert.equal(store.visitors[0]!.displayName, "Mrs Okolo");
    assert.equal(store.visitors[0]!.phone, "+2348031234567");
    assert.deepEqual(store.audits.map((entry) => entry.entity), ["visitor", "visit"]);
    assert.doesNotMatch(JSON.stringify(store.audits), /Okolo|803/, "no name or number in the audit log");
  });

  it("ONE OPEN VISIT per client: a second check-in is refused, naming the open one", async () => {
    const store = new MemoryStore();
    await checkedIn(store, client);
    const second = await checkIn(client, deps(store));
    assert.equal(second.ok, false);
    assert.ok(!second.ok && second.kind === "refused");
    if (!second.ok) assert.match(second.message, /Chidinma Okafor is already checked in since 11:00, checked in by Joy Akpan\. Check that visit out first\./);
    assert.equal(store.visits.length, 1);
    assert.ok(store.locks.includes(identityKey({ clientId: CLIENT })), "checked under a lock on the client");
  });

  it("an open visit from an earlier day blocks too, and says which day", async () => {
    const store = new MemoryStore();
    await checkedIn(store, client);
    store.visits[0]!.checkedInAt = new Date("2026-10-23T08:30:00Z");
    const second = await checkIn(client, deps(store));
    assert.ok(!second.ok && /since 09:30 on 23 Oct 2026/.test(second.message));
  });

  it("after check-out the same client can check in again", async () => {
    const store = new MemoryStore();
    const first = await checkedIn(store, client);
    assert.deepEqual(await checkOut({ visitId: first }, deps(store)), { ok: true, name: "Chidinma Okafor" });
    await checkedIn(store, client);
    assert.equal(store.visits.length, 2);
  });

  it("a removed open visit does not block", async () => {
    const store = new MemoryStore();
    await checkedIn(store, client);
    store.visits[0]!.voidedAt = NOW;
    await checkedIn(store, client);
  });

  it("a number on file asks before anything is written; confirmed, the same visitor is reused", async () => {
    const store = new MemoryStore();
    const first = await checkedIn(store, { ...base, name: "Bola Ade", phone: "0803 123 4567" });
    await checkOut({ visitId: first }, deps(store));
    const auditsBefore = store.audits.length;

    const asked = await checkIn({ ...base, name: "Bola Adeyemi", phone: "+234 803 123 4567" }, deps(store));
    assert.ok(!asked.ok && asked.kind === "confirm_visitor");
    if (!asked.ok && asked.kind === "confirm_visitor") {
      assert.match(asked.message, /That number is on file for Bola Ade, last here 26 Oct 2026\. Is this the same person\?/);
      assert.equal(store.visits.length, 1, "nothing written while asking");
      assert.equal(store.audits.length, auditsBefore);
      const confirmed = await checkIn({ ...base, name: "Bola Adeyemi", phone: "+234 803 123 4567", sameVisitorId: asked.visitor.id }, deps(store));
      assert.ok(confirmed.ok);
      assert.equal(confirmed.ok && confirmed.name, "Bola Ade", "checked in under the name on file");
      assert.equal(store.visitors.length, 1, "no second visitor row");
      assert.equal(store.visits[1]!.visitorId, store.visitors[0]!.id);
    }
  });

  it("a confirmed repeat visitor who is still in is refused", async () => {
    const store = new MemoryStore();
    await checkedIn(store, { ...base, phone: "08031234567" });
    const visitorId = store.visitors[0]!.id;
    const again = await checkIn({ ...base, phone: "08031234567", sameVisitorId: visitorId }, deps(store));
    assert.ok(!again.ok && again.kind === "refused" && /already checked in/.test(again.message));
  });

  it("no phone, no match: a new visitor row every time (never an automatic merge)", async () => {
    const store = new MemoryStore();
    await checkedIn(store, base);
    await checkedIn(store, base);
    assert.equal(store.visitors.length, 2);
  });

  it("refused input writes nothing", async () => {
    const store = new MemoryStore();
    const result = await checkIn({ ...base, consent: false }, deps(store));
    assert.deepEqual(result, { ok: false, kind: "refused", message: MESSAGES.consent, field: "consent" });
    assert.equal(store.visits.length + store.visitors.length + store.audits.length, 0);
  });
});

describe("checkOut and closing the day", () => {
  it("records who checked them out; a second click says who got there first", async () => {
    const store = new MemoryStore();
    const id = await checkedIn(store, client);
    assert.equal((await checkOut({ visitId: id }, deps(store))).ok, true);
    assert.equal(store.visits[0]!.checkedOutBy, DESK);
    assert.equal(store.visits[0]!.closeReason, "NORMAL");
    const again = await checkOut({ visitId: id }, deps(store));
    assert.deepEqual(again, { ok: false, message: "Chidinma Okafor was already checked out at 11:00 by Joy Akpan." });
  });

  it("a removed visit cannot be checked out", async () => {
    const store = new MemoryStore();
    const id = await checkedIn(store, client);
    store.visits[0]!.voidedAt = NOW;
    assert.deepEqual(await checkOut({ visitId: id }, deps(store)), { ok: false, message: "Chidinma Okafor's visit has been removed." });
  });

  it("closing the day is AUTO_CLOSED with who did it, and skips what is already closed", async () => {
    const store = new MemoryStore();
    const a = await checkedIn(store, client);
    const b = await checkedIn(store, base);
    await checkOut({ visitId: b }, deps(store));
    const result = await closeDay({ visitIds: [a, b] }, deps(store));
    assert.deepEqual(result, { ok: true, closed: 1, skipped: [{ name: "Bola Ade", reason: "already closed" }] });
    assert.equal(store.visits[0]!.closeReason, "AUTO_CLOSED");
    assert.equal(store.visits[0]!.checkedOutBy, DESK);
    assert.match(JSON.stringify(store.audits.at(-1)), /"via":"end of day"/);
    assert.deepEqual(await closeDay({ visitIds: [] }, deps(store)), { ok: false, message: "There are no visits to close." });
  });
});

describe("correctVisit", () => {
  async function one(store: MemoryStore, input: CheckInInput = base) {
    const id = await checkedIn(store, input);
    return { id, version: () => String(store.visits.find((visit) => visit.id === id)!.updatedAt) };
  }
  const fix = (store: MemoryStore, visitId: string, version: string, kind: string, extra: { time?: string; value?: string; reason?: string } = {}) =>
    correctVisit({ visitId, version, kind, time: extra.time ?? "", value: extra.value ?? "", reason: extra.reason ?? "typed wrong" }, deps(store));

  it("needs a reason, checked before anything is read", async () => {
    const store = new MemoryStore();
    const { id, version } = await one(store);
    assert.deepEqual(await fix(store, id, version(), "reason", { value: "COMPLAINT", reason: "  " }), { ok: false, message: MESSAGES.needsReason });
    assert.equal(store.locks.filter((lock) => lock.startsWith("visit:")).length, 0, "nothing was read or locked");
  });

  it("changes the reason, marks the visit corrected, and audits before and after", async () => {
    const store = new MemoryStore();
    const { id, version } = await one(store);
    const result = await fix(store, id, version(), "reason", { value: "COMPLAINT", reason: "she said complaint" });
    assert.deepEqual(result, { ok: true, message: "Bola Ade: reason changed from Inquiry to Complaint." });
    const visit = store.visits[0]!;
    assert.equal(visit.reasonCode, "COMPLAINT");
    assert.equal(visit.correctedBy, DESK);
    assert.equal(visit.correctionReason, "she said complaint");
    assert.deepEqual(store.audits.at(-1)!.before, { reason_code: "INQUIRY" });
  });

  it("refuses a stale version: someone else changed it", async () => {
    const store = new MemoryStore();
    const { id, version } = await one(store);
    const seen = version();
    await fix(store, id, seen, "toSee", { value: "Peter Obi" });
    assert.deepEqual(await fix(store, id, seen, "reason", { value: "COMPLAINT" }), { ok: false, message: MESSAGES.staleVersion });
  });

  it("check-in time: on the visit's own day, not in the future, before the check-out", async () => {
    const store = new MemoryStore();
    const { id, version } = await one(store);
    assert.deepEqual(await fix(store, id, version(), "checkin", { time: "2300" }), { ok: false, message: "That time has not happened yet." });
    assert.deepEqual(await fix(store, id, version(), "checkin", { time: "0930" }), { ok: true, message: "Bola Ade: check-in changed from 11:00 to 09:30." });
    assert.equal(store.visits[0]!.checkedInAt.toISOString(), "2026-10-26T08:30:00.000Z");
    await checkOut({ visitId: id }, deps(store));
    assert.deepEqual(await fix(store, id, version(), "checkin", { time: "1100" }), { ok: false, message: "Check-in must be before the check-out, 11:00." });
  });

  it("check-out time only on a closed visit; an end-of-day close gets a real time and becomes NORMAL", async () => {
    const store = new MemoryStore();
    const { id, version } = await one(store);
    assert.deepEqual(await fix(store, id, version(), "checkout", { time: "1000" }), { ok: false, message: "Bola Ade has not been checked out. Use Check out." });
    await fix(store, id, version(), "checkin", { time: "0900" });
    await closeDay({ visitIds: [id] }, deps(store));
    const result = await fix(store, id, version(), "checkout", { time: "1015", reason: "the book says 10:15" });
    assert.deepEqual(result, { ok: true, message: "Bola Ade: left at 10:15 (the visit had been closed at the end of the day with no time)." });
    assert.equal(store.visits[0]!.closeReason, "NORMAL");
    assert.equal(store.visits[0]!.checkedOutBy, DESK, "still attributed to whoever closed it");
    assert.deepEqual(await fix(store, id, version(), "checkout", { time: "0830" }), { ok: false, message: "Check-out must be after the check-in, 09:00." });
  });

  it("reopen undoes a check-out, unless they already have another open visit", async () => {
    const store = new MemoryStore();
    const { id, version } = await one(store, client);
    await checkOut({ visitId: id }, deps(store));
    assert.equal((await fix(store, id, version(), "reopen")).ok, true);
    assert.equal(store.visits[0]!.checkedOutAt, null);
    await checkOut({ visitId: id }, deps(store));
    await checkedIn(store, client);
    const blocked = await fix(store, id, version(), "reopen");
    assert.ok(!blocked.ok && /already checked in since 11:00/.test(blocked.message));
  });

  it("type swaps only between non-client types, and never on a client's visit", async () => {
    const store = new MemoryStore();
    const { id, version } = await one(store);
    assert.deepEqual(await fix(store, id, version(), "type", { value: "REALTOR" }), { ok: true, message: "Bola Ade: changed from Visitor to Realtor." });
    assert.equal((await fix(store, id, version(), "type", { value: "CLIENT" })).ok, false);
    const unavailable = await one(store, { ...base, visitorType: "CLIENT", lookup: "PORTAL_UNAVAILABLE", name: "Mrs Okolo" });
    assert.equal((await fix(store, unavailable.id, unavailable.version(), "type", { value: "VISITOR" })).ok, false);
  });

  it("a visitor's name and phone are fixed on their record; a client's name is kept as logged", async () => {
    const store = new MemoryStore();
    const { id, version } = await one(store, { ...base, phone: "08031234567" });
    assert.equal((await fix(store, id, version(), "name", { value: "Bola  Adewale" })).ok, true);
    assert.equal(store.visitors[0]!.displayName, "Bola Adewale");
    assert.equal(store.visits[0]!.correctionReason, "typed wrong", "the visit is marked");
    assert.doesNotMatch(JSON.stringify(store.audits), /Adewale/, "no name in the audit log");
    assert.deepEqual(await fix(store, id, version(), "phone", { value: "0803 123 456" }), { ok: false, message: PHONE_MESSAGE });
    assert.equal((await fix(store, id, version(), "phone", { value: "" })).ok, true);
    assert.equal(store.visitors[0]!.phone, null);

    const other = await one(store, { ...base, name: "Uche Obi", phone: "08099999999" });
    const taken = await fix(store, id, version(), "phone", { value: "0809 999 9999" });
    assert.deepEqual(taken, {
      ok: false,
      message: "That number is already on file for Uche Obi. If this is the same person, tell an administrator; the records are not merged here.",
    });
    assert.ok(other.id);

    const theirs = await one(store, client);
    assert.equal((await fix(store, theirs.id, theirs.version(), "name", { value: "Someone Else" })).ok, false);
  });

  it("remove is a void: it counts for nothing, frees the person, and can be restored unless that makes two open visits", async () => {
    const store = new MemoryStore();
    const { id, version } = await one(store, client);
    assert.equal((await fix(store, id, version(), "void", { reason: "wrong client" })).ok, true);
    assert.notEqual(store.visits[0]!.voidedAt, null);
    assert.equal(store.visits.length, 1, "never deleted");
    assert.deepEqual(await fix(store, id, version(), "reason", { value: "COMPLAINT" }), {
      ok: false,
      message: "Chidinma Okafor's visit has been removed. Restore it first to change it.",
    });
    const replacement = await checkedIn(store, client);
    const blocked = await fix(store, id, version(), "restore", { reason: "removed by mistake" });
    assert.ok(!blocked.ok && /cannot be restored/.test(blocked.message));
    await checkOut({ visitId: replacement }, deps(store));
    assert.deepEqual(await fix(store, id, version(), "restore", { reason: "removed by mistake" }), { ok: true, message: "Chidinma Okafor's visit was restored." });
  });

  it("a write that loses the race is refused as stale, never written twice", async () => {
    const store = new MemoryStore();
    const { id, version } = await one(store);
    const seen = version();
    store.interleave = () => store.touch(store.visits[0]!);
    assert.deepEqual(await fix(store, id, seen, "reason", { value: "COMPLAINT" }), { ok: false, message: MESSAGES.staleVersion });
    assert.equal(store.visits[0]!.reasonCode, "INQUIRY");
  });
});

describe("groupVisitDay", () => {
  const row = (over: Partial<VisitRow>): VisitRow => ({
    id: "x",
    version: "1",
    name: "A",
    isClient: false,
    visitorTypeCode: "VISITOR",
    reasonCode: "INQUIRY",
    toSee: null,
    lookupOutcome: "NOT_LOOKED_UP",
    organisation: null,
    checkedInAt: new Date("2026-10-26T08:00:00Z"),
    checkedInByName: DESK_NAME,
    checkedOutAt: null,
    checkedOutByName: null,
    closeReason: null,
    correctedAt: null,
    correctedByName: null,
    correctionReason: null,
    voidedAt: null,
    ...over,
  });

  it("counts real visits only: open from earlier days are in the building but not today's count; removed count nowhere", () => {
    const day = groupVisitDay(
      [
        row({ id: "in" }),
        row({ id: "older", checkedInAt: new Date("2026-10-24T09:00:00Z"), visitorTypeCode: "CLIENT", isClient: true }),
        row({ id: "left", checkedOutAt: new Date("2026-10-26T09:00:00Z"), closeReason: "NORMAL" }),
        row({ id: "auto", checkedOutAt: new Date("2026-10-26T17:00:00Z"), closeReason: "AUTO_CLOSED" }),
        row({ id: "gone", voidedAt: NOW }),
      ],
      NOW,
      "2026-10-26",
    );
    assert.deepEqual(day.inBuilding.map((visit) => visit.id), ["older", "in"]);
    assert.equal(day.inBuilding[0]!.olderDay, true);
    assert.deepEqual(day.counts, { visits: 3, inBuilding: 2, left: 2, leftUnknown: 1, removed: 1 });
    assert.deepEqual(day.inBuildingByType, { CLIENT: 1, VISITOR: 1 });
    assert.equal(day.left.find((visit) => visit.id === "left")!.lengthMs, 60 * 60 * 1000);
    assert.equal(day.left.find((visit) => visit.id === "auto")!.lengthMs, null, "closed at the end of the day: length unknown, never a duration");
  });

  it("an earlier day shows only that day's visits", () => {
    const day = groupVisitDay([row({ id: "older", checkedInAt: new Date("2026-10-24T09:00:00Z") })], NOW, "2026-10-25");
    assert.equal(day.isToday, false);
    assert.equal(day.inBuilding.length, 0);
  });
});
