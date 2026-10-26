// The movement book's rules against an in-memory store whose transaction rolls back. No
// database. Run: npm test
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  recordDeparture,
  recordReturn,
  type DepartureInput,
  type ExistingMovement,
  type MovementAudit,
  type MovementDeps,
  type MovementShift,
  type MovementStore,
  type MovementTx,
  type NewMovement,
} from "./movements.ts";
import { phraseKey } from "./phraseMatch.ts";
import type { RosterName } from "./rosterMatch.ts";

const ACTOR = "00000000-0000-4000-8000-0000000000b2";
// 10:45 on Wednesday 21 October 2026 in Lagos (UTC+1).
const NOW = new Date(Date.UTC(2026, 9, 21, 9, 45));
const lagos = (hour: number, minute = 0) => new Date(Date.UTC(2026, 9, 21, hour - 1, minute));

interface StoredMovement extends NewMovement {
  returnedAt: Date | null;
  returnedBy: string | null;
  voidedAt: Date | null;
}

class MemoryStore implements MovementStore {
  roster: RosterName[] = [
    { id: "p-peter", name: "Peter Obi", department: "Admin" },
    { id: "p-divine", name: "Divine Mike", department: "Front desk" },
    { id: "p-ada1", name: "Ada Okafor", department: "Legal" },
    { id: "p-ada2", name: "Ada Okafor", department: "Finance" },
  ];
  shifts = new Map<string, MovementShift & { clockOutAt: Date | null }>();
  movements: StoredMovement[] = [];
  audits: MovementAudit[] = [];
  createdPeople: { id: string; name: string }[] = [];
  staleReturn = false;

  addShift(id: string, name: string, extra: Partial<MovementShift> = {}) {
    this.shifts.set(id, { id, staffId: `s-${name}`, name, clockInAt: lagos(7, 15), clockOutAt: null, signoutMissingAt: null, voidedAt: null, liveMovements: [], ...extra });
  }

  addMovement(recordId: string, extra: Partial<StoredMovement> = {}) {
    this.movements.push({
      id: `m${this.movements.length + 1}`,
      recordId,
      leftAt: lagos(9, 0),
      destination: "Bank",
      purpose: "Lodgement",
      approvedBy: "p-peter",
      leftEnteredBy: "someone",
      returnedAt: null,
      returnedBy: null,
      voidedAt: null,
      ...extra,
    });
  }

  async transaction<T>(work: (tx: MovementTx) => Promise<T>): Promise<T> {
    const snapshot = { movements: this.movements.map((m) => ({ ...m })), audits: [...this.audits], created: [...this.createdPeople], roster: [...this.roster] };
    try {
      return await work(this.tx());
    } catch (error) {
      this.movements = snapshot.movements;
      this.audits = snapshot.audits;
      this.createdPeople = snapshot.created;
      this.roster = snapshot.roster;
      throw error;
    }
  }

  private live(recordId: string) {
    return this.movements.filter((m) => m.recordId === recordId && m.voidedAt === null).map((m) => ({ id: m.id, leftAt: m.leftAt, returnedAt: m.returnedAt }));
  }

  private tx(): MovementTx {
    return {
      lockRecord: async () => {},
      lockMovement: async () => {},
      loadRoster: async () => this.roster.map((p) => ({ ...p })),
      loadPhrases: async () => {
        // One spelling per key, live movements only (as movementStore.ts does).
        const live = this.movements.filter((m) => m.voidedAt === null);
        const one = (values: string[]) => [...new Map(values.map((v) => [phraseKey(v), v] as const)).values()];
        return { destinations: one(live.map((m) => m.destination)), purposes: one(live.map((m) => m.purpose)) };
      },
      shift: async (id) => {
        const shift = this.shifts.get(id);
        // Removed (voided) movements are NOT in liveMovements: they count for nothing.
        return shift ? { ...shift, liveMovements: this.live(id) } : null;
      },
      movement: async (id) => {
        const m = this.movements.find((x) => x.id === id);
        if (!m) return null;
        const shift = this.shifts.get(m.recordId)!;
        return {
          id: m.id,
          recordId: m.recordId,
          staffId: shift.staffId,
          name: shift.name,
          leftAt: m.leftAt,
          returnedAt: m.returnedAt,
          returnedByName: m.returnedBy,
          voidedAt: m.voidedAt,
          recordClockOutAt: shift.clockOutAt,
          recordVoidedAt: shift.voidedAt,
        } satisfies ExistingMovement;
      },
      createPerson: async ({ id, name }) => {
        this.roster.push({ id, name, department: null });
        this.createdPeople.push({ id, name });
      },
      createMovement: async (movement) => {
        this.movements.push({ ...movement, returnedAt: null, returnedBy: null, voidedAt: null });
      },
      returnMovement: async ({ id, returnedAt, actorId }) => {
        const m = this.movements.find((x) => x.id === id)!;
        if (this.staleReturn || m.returnedAt !== null || m.voidedAt !== null) return false;
        m.returnedAt = returnedAt;
        m.returnedBy = actorId;
        return true;
      },
      audit: async (entry) => {
        this.audits.push(entry);
      },
    };
  }
}

let ids = 0;
function setup() {
  const store = new MemoryStore();
  const deps: MovementDeps = { store, actorId: ACTOR, now: NOW, newId: () => `new-${(ids += 1)}` };
  const leave = (recordId: string, extra: Partial<DepartureInput> = {}) =>
    recordDeparture(
      { recordId, destination: "Bank", purpose: "Lodgement", timeLeft: "09:30", approver: { name: "Peter Obi", personId: null, confirmNew: false }, ...extra },
      deps,
    );
  return { store, deps, leave };
}

const refused = (result: { ok: boolean; message: string }) => {
  assert.equal(result.ok, false, "expected the movement to be refused");
  return result.message;
};

describe("recording a departure", () => {
  it("records where, what for, who approved and the time left, by the signed-in user, with one audit row", async () => {
    const { store, leave } = setup();
    store.addShift("r1", "Divine Mike");
    const result = await leave("r1");
    assert.deepEqual(result, { ok: true, message: "Divine Mike is out: Bank. Approved by Peter Obi." });
    const m = store.movements[0]!;
    assert.equal(m.recordId, "r1");
    assert.equal(m.destination, "Bank");
    assert.equal(m.purpose, "Lodgement");
    assert.equal(m.approvedBy, "p-peter", "the approver is a roster person");
    assert.equal(m.leftEnteredBy, ACTOR);
    assert.equal(m.leftAt.toISOString(), "2026-10-21T08:30:00.000Z");
    assert.equal(store.audits.length, 1);
    assert.equal(store.audits[0]!.entity, "movement");
    assert.equal(store.audits[0]!.action, "CREATE");
    assert.equal(store.audits[0]!.after.via, "departure");
  });

  it("keeps what she typed (spacing tidied, capitalisation untouched)", async () => {
    const { store, leave } = setup();
    store.addShift("r1", "Divine Mike");
    await leave("r1", { destination: "  GraceWaters   site ", purpose: "inspection  of  plots" });
    assert.equal(store.movements[0]!.destination, "GraceWaters site");
    assert.equal(store.movements[0]!.purpose, "inspection of plots");
  });

  it("needs a destination, a purpose and a readable time", async () => {
    const { store, leave } = setup();
    store.addShift("r1", "Divine Mike");
    assert.equal(refused(await leave("r1", { destination: "  " })), "Say where they are going.");
    assert.equal(refused(await leave("r1", { purpose: "" })), "Say what it is for.");
    assert.match(refused(await leave("r1", { timeLeft: "930pm" })), /Type the time as/);
    assert.equal(store.movements.length, 0);
  });

  it("the approver is resolved by the SAME rules as arrivals: a close name is a question", async () => {
    const { store, leave } = setup();
    store.addShift("r1", "Divine Mike");
    const message = refused(await leave("r1", { approver: { name: "Peter Obii", personId: null, confirmNew: false } }));
    assert.match(message, /Peter Obii is close to Peter Obi\. Say whether/);
    assert.equal(store.movements.length, 0);
    assert.equal(store.createdPeople.length, 0, "nobody is created by a question");
  });

  it("a close name confirmed as a different person, or a name nobody has, creates a roster person (audited without the name)", async () => {
    const { store, leave } = setup();
    store.addShift("r1", "Divine Mike");
    const result = await leave("r1", { approver: { name: "Peter Obii", personId: null, confirmNew: true } });
    assert.equal(result.ok, true);
    assert.deepEqual(store.createdPeople.map((p) => p.name), ["Peter Obii"]);
    assert.equal(store.movements[0]!.approvedBy, store.createdPeople[0]!.id);
    const person = store.audits.find((a) => a.entity === "staff")!;
    assert.deepEqual(person.after, { roster: true, via: "movement approver" });
    assert.ok(!JSON.stringify(store.audits).includes("Obii"));
  });

  it("two people of one name need a pick; picking by id works", async () => {
    const { store, leave } = setup();
    store.addShift("r1", "Divine Mike");
    assert.match(refused(await leave("r1", { approver: { name: "Ada Okafor", personId: null, confirmNew: false } })), /More than one person is called Ada Okafor/);
    const ok = await leave("r1", { approver: { name: "Ada Okafor", personId: "p-ada2", confirmNew: false } });
    assert.equal(ok.ok, true);
    assert.equal(store.movements[0]!.approvedBy, "p-ada2");
  });

  it("a person MAY approve their own movement (nobody is above the most senior person): saved, and said so", async () => {
    const { store, leave } = setup();
    store.addShift("r1", "Peter Obi", { staffId: "p-peter" });
    const result = await leave("r1");
    assert.deepEqual(result, { ok: true, message: "Peter Obi is out: Bank. Self-approved." });
    assert.equal(store.movements[0]!.approvedBy, "p-peter", "the approver is the person who left; the mark is derived from that");
  });

  it("no drift: a destination or purpose differing only by case or spacing takes the EXISTING spelling", async () => {
    const { store, leave } = setup();
    store.addShift("r0", "Grace Nkem");
    store.addMovement("r0", { destination: "First Bank", purpose: "Cheque lodgement", returnedAt: lagos(9, 20) });
    store.addShift("r1", "Divine Mike");
    const result = await leave("r1", { destination: "first   bank", purpose: "CHEQUE LODGEMENT" });
    assert.deepEqual(result, { ok: true, message: "Divine Mike is out: First Bank. Approved by Peter Obi." });
    assert.equal(store.movements[1]!.destination, "First Bank");
    assert.equal(store.movements[1]!.purpose, "Cheque lodgement");
    assert.equal(store.audits.at(-1)!.after.destination, "First Bank", "the audit row carries what was stored");
  });

  it("no drift: a CLOSE spelling is a question offering the existing one; saying 'different' stores what she typed", async () => {
    const { store, leave } = setup();
    store.addShift("r0", "Grace Nkem");
    store.addMovement("r0", { destination: "First Bank", returnedAt: lagos(9, 20) });
    store.addShift("r1", "Divine Mike");
    assert.equal(refused(await leave("r1", { destination: "Frist Bank" })), 'Where to: "Frist Bank" is close to First Bank, used before. Say whether it is the same place or a different one.');
    assert.equal(store.movements.length, 1, "nothing is written by a question");
    assert.equal((await leave("r1", { destination: "Frist Bank", destinationConfirmNew: true })).ok, true);
    assert.equal(store.movements[1]!.destination, "Frist Bank");
  });

  it("no drift: a removed movement's spelling is not offered or used", async () => {
    const { store, leave } = setup();
    store.addShift("r0", "Grace Nkem");
    store.addMovement("r0", { destination: "first bank", voidedAt: lagos(9, 30) });
    store.addShift("r1", "Divine Mike");
    assert.equal((await leave("r1", { destination: "First Bank" })).ok, true);
    assert.equal(store.movements[1]!.destination, "First Bank");
  });

  it("must sit INSIDE the shift: after the time in, and not in the future", async () => {
    const { store, leave } = setup();
    store.addShift("r1", "Divine Mike"); // in at 07:15
    for (const early of ["07:15", "07:00", "06:00"]) {
      assert.equal(refused(await leave("r1", { timeLeft: early })), "Time left must be after their time in, 07:15.", early);
    }
    assert.equal(refused(await leave("r1", { timeLeft: "10:46" })), "That time has not happened yet.");
    assert.equal((await leave("r1", { timeLeft: "10:45" })).ok, true, "right now is fine");
  });

  it("is only for someone who is IN: not a closed shift, a never-signed-out shift, or a removed record", async () => {
    const { store, leave } = setup();
    store.addShift("gone", "Gone Person", { clockOutAt: lagos(9) });
    store.addShift("marked", "Marked Person", { signoutMissingAt: lagos(9) });
    store.addShift("removed", "Wrong Person", { voidedAt: lagos(9) });
    assert.match(refused(await leave("gone")), /is not in: their shift is closed/);
    assert.match(refused(await leave("marked")), /is not in: their shift is closed/);
    assert.equal(refused(await leave("removed")), "Wrong Person's record has been removed.");
    assert.equal(refused(await leave("nope")), "That record has changed. Reload the page and look again.");
    assert.equal(store.movements.length, 0);
  });

  it("refuses someone already out, and a time that overlaps an earlier movement", async () => {
    const { store, leave } = setup();
    store.addShift("r1", "Divine Mike");
    store.addMovement("r1", { leftAt: lagos(9, 0) }); // out since 09:00
    assert.equal(refused(await leave("r1")), "Divine Mike is already recorded as out, since 09:00. Record their return first.");
    store.movements[0]!.returnedAt = lagos(9, 45);
    assert.match(refused(await leave("r1", { timeLeft: "09:30" })), /overlaps that time/);
    assert.equal((await leave("r1", { timeLeft: "09:45" })).ok, true, "leaving the minute they came back is fine");
  });

  it("a REMOVED movement counts for nothing: it does not keep the person out", async () => {
    const { store, leave } = setup();
    store.addShift("r1", "Divine Mike");
    store.addMovement("r1", { leftAt: lagos(9, 0), voidedAt: lagos(9, 30) }); // removed, never returned
    const result = await leave("r1", { timeLeft: "09:20" });
    assert.equal(result.ok, true, "a removed movement is neither 'out' nor an overlap");
    assert.equal(store.movements.filter((m) => m.voidedAt === null).length, 1);
  });
});

describe("recording a return", () => {
  it("records the time back, by the signed-in user (who may not be who recorded the departure), and one audit row", async () => {
    const { store, deps } = setup();
    store.addShift("r1", "Divine Mike");
    store.addMovement("r1", { leftAt: lagos(9, 0), leftEnteredBy: "desk-a" });
    const result = await recordReturn({ movementId: "m1", timeReturned: "09:40" }, deps);
    assert.deepEqual(result, { ok: true, message: "Divine Mike is back at 09:40." });
    const m = store.movements[0]!;
    assert.equal(m.returnedAt!.toISOString(), "2026-10-21T08:40:00.000Z");
    assert.equal(m.returnedBy, ACTOR);
    assert.notEqual(m.leftEnteredBy, ACTOR, "the departure was typed by someone else");
    assert.equal(store.audits.length, 1);
    assert.deepEqual(store.audits[0]!.before, { returned_at: null });
    assert.equal(store.audits[0]!.after.via, "return");
  });

  it("a return before the departure, or at the same time, is refused, and says when they left", async () => {
    const { store, deps } = setup();
    store.addShift("r1", "Divine Mike");
    store.addMovement("r1", { leftAt: lagos(9, 0) });
    for (const early of ["08:59", "08:00", "09:00"]) {
      const result = await recordReturn({ movementId: "m1", timeReturned: early }, deps);
      assert.equal(refused(result), "Time back must be after the time they left, 09:00.", early);
    }
    assert.equal(store.movements[0]!.returnedAt, null);
  });

  it("is refused in the future, malformed, or after their time out", async () => {
    const { store, deps } = setup();
    store.addShift("r1", "Divine Mike", { clockOutAt: lagos(10, 0) });
    store.addMovement("r1", { leftAt: lagos(9, 0) });
    assert.equal(refused(await recordReturn({ movementId: "m1", timeReturned: "10:46" }, deps)), "That time has not happened yet.");
    assert.match(refused(await recordReturn({ movementId: "m1", timeReturned: "noon" }, deps)), /Type the time as/);
    assert.equal(refused(await recordReturn({ movementId: "m1", timeReturned: "10:30" }, deps)), "Time back must be before their time out, 10:00.");
  });

  it("a stale click (already back, or removed) is a clear message naming who got there first, and writes nothing", async () => {
    const { store, deps } = setup();
    store.addShift("r1", "Divine Mike");
    store.addMovement("r1", { leftAt: lagos(9, 0), returnedAt: lagos(9, 30), returnedBy: "Desk B" });
    store.addMovement("r1", { leftAt: lagos(10, 0), voidedAt: lagos(10, 5) });
    assert.equal(refused(await recordReturn({ movementId: "m1", timeReturned: "10:00" }, deps)), "Divine Mike was already recorded as back at 09:30 by Desk B.");
    assert.equal(refused(await recordReturn({ movementId: "m2", timeReturned: "10:30" }, deps)), "Divine Mike's movement has been removed.");
    assert.equal(store.audits.length, 0);
    store.addMovement("r1", { leftAt: lagos(10, 10) });
    store.staleReturn = true;
    assert.equal(refused(await recordReturn({ movementId: "m3", timeReturned: "10:30" }, deps)), "That record has changed. Reload the page and look again.");
  });
});
