// Movement corrections against an in-memory store that keeps a version per movement and
// rolls back. No database. Run: npm test
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { NEEDS_REASON, STALE_VERSION } from "./corrections.ts";
import {
  MOVEMENT_CORRECTION_KINDS,
  correctMovement,
  type CorrectableMovement,
  type MovementCorrection,
  type MovementCorrectionDeps,
  type MovementCorrectionInput,
  type MovementCorrectionStore,
  type MovementCorrectionTx,
} from "./movementCorrections.ts";
import type { MovementAudit } from "./movements.ts";
import { phraseKey } from "./phraseMatch.ts";
import type { RosterName } from "./rosterMatch.ts";

const ACTOR = "00000000-0000-4000-8000-0000000000b2";
// 10:45 on Wednesday 21 October 2026 in Lagos (UTC+1).
const NOW = new Date(Date.UTC(2026, 9, 21, 9, 45));
const lagos = (hour: number, minute = 0) => new Date(Date.UTC(2026, 9, 21, hour - 1, minute));

interface Stored extends CorrectableMovement {
  correctedBy: string | null;
  correctionReason: string | null;
}

class MemoryStore implements MovementCorrectionStore {
  movements = new Map<string, Stored>();
  audits: MovementAudit[] = [];
  roster: RosterName[] = [
    { id: "p-peter", name: "Peter Obi", department: "Admin" },
    { id: "p-chidi", name: "Chidi Eze", department: "Legal" },
  ];
  createdPeople: { id: string; name: string }[] = [];
  /** Phrases used by OTHER movements (not in this store). */
  used = { destinations: [] as string[], purposes: [] as string[] };
  private counter = 0;

  add(id: string, extra: Partial<Stored> = {}) {
    this.movements.set(id, {
      id,
      recordId: "r1",
      staffId: "s-divine",
      name: "Divine Mike",
      leftAt: lagos(9, 0),
      returnedAt: lagos(9, 40),
      destination: "Bank",
      purpose: "Lodgement",
      approvedById: "p-peter",
      approvedByName: "Peter Obi",
      voidedAt: null,
      version: `v${(this.counter += 1)}`,
      recordClockInAt: lagos(7, 15),
      recordClockOutAt: null,
      recordVoidedAt: null,
      others: [],
      correctedBy: null,
      correctionReason: null,
      ...extra,
    });
  }
  get(id: string) {
    return this.movements.get(id)!;
  }

  async transaction<T>(work: (tx: MovementCorrectionTx) => Promise<T>): Promise<T> {
    const snapshot = new Map([...this.movements].map(([id, m]) => [id, { ...m }]));
    const audits = [...this.audits];
    try {
      return await work(this.tx());
    } catch (error) {
      this.movements = snapshot;
      this.audits = audits;
      throw error;
    }
  }

  private tx(): MovementCorrectionTx {
    return {
      lock: async () => {},
      find: async (id) => (this.movements.has(id) ? { ...this.movements.get(id)! } : null),
      loadRoster: async () => this.roster.map((p) => ({ ...p })),
      loadPhrases: async () => {
        const live = [...this.movements.values()].filter((m) => m.voidedAt === null);
        const one = (values: string[]) => [...new Map(values.map((v) => [phraseKey(v), v] as const)).values()];
        return { destinations: one([...this.used.destinations, ...live.map((m) => m.destination)]), purposes: one([...this.used.purposes, ...live.map((m) => m.purpose)]) };
      },
      createPerson: async ({ id, name }) => {
        this.roster.push({ id, name, department: null });
        this.createdPeople.push({ id, name });
      },
      apply: async ({ id, version, actorId, reason, correction }) => {
        const m = this.movements.get(id)!;
        if (m.version !== version || (correction.kind !== "restore" && m.voidedAt !== null)) return false;
        this.change(m, correction);
        m.correctedBy = actorId;
        m.correctionReason = reason;
        m.version = `v${(this.counter += 1)}`;
        return true;
      },
      audit: async (entry) => {
        this.audits.push(entry);
      },
    };
  }

  private change(m: Stored, c: MovementCorrection) {
    if (c.kind === "left") m.leftAt = c.leftAt;
    else if (c.kind === "returned") m.returnedAt = c.returnedAt;
    else if (c.kind === "destination") m.destination = c.destination;
    else if (c.kind === "purpose") m.purpose = c.purpose;
    else if (c.kind === "approver") m.approvedById = c.approvedBy;
    else if (c.kind === "void") m.voidedAt = NOW;
    else if (c.kind === "restore") m.voidedAt = null;
  }
}

let ids = 0;
function setup() {
  const store = new MemoryStore();
  const deps: MovementCorrectionDeps = { store, actorId: ACTOR, now: NOW, newId: () => `new-${(ids += 1)}` };
  const run = (id: string, kind: string, extra: Partial<MovementCorrectionInput> = {}) =>
    correctMovement(
      {
        movementId: id,
        version: store.get(id).version,
        kind,
        time: "",
        destination: "",
        purpose: "",
        approver: { name: "", personId: null, confirmNew: false },
        reason: "The book says so",
        ...extra,
      },
      deps,
    );
  return { store, deps, run };
}

const refused = (result: { ok: boolean; message: string }) => {
  assert.equal(result.ok, false, "expected the correction to be refused");
  return result.message;
};

describe("EVERY movement correction needs a reason", () => {
  it("is refused for every kind when the reason is missing, blank or only spaces, and nothing changes", async () => {
    for (const kind of MOVEMENT_CORRECTION_KINDS) {
      for (const reason of ["", "   ", "\t"]) {
        const { store, run } = setup();
        store.add("m1");
        const before = JSON.stringify(store.get("m1"));
        assert.equal(refused(await run("m1", kind, { time: "09:10", destination: "Court", purpose: "Hearing", reason })), NEEDS_REASON, `${kind}`);
        assert.equal(JSON.stringify(store.get("m1")), before);
        assert.equal(store.audits.length, 0);
      }
    }
  });
});

describe("what can be corrected, and who and why it records", () => {
  it("the time left, with who, when and why, and one audit row with before and after", async () => {
    const { store, run } = setup();
    store.add("m1"); // left 09:00, back 09:40
    const result = await run("m1", "left", { time: "08:30", reason: "Book says 08:30" });
    assert.deepEqual(result, { ok: true, message: "Divine Mike: time left changed from 09:00 to 08:30." });
    assert.equal(store.get("m1").leftAt.toISOString(), "2026-10-21T07:30:00.000Z");
    assert.equal(store.get("m1").correctedBy, ACTOR);
    assert.equal(store.get("m1").correctionReason, "Book says 08:30");
    const audit = store.audits[0]!;
    assert.equal(audit.entity, "movement");
    assert.equal(audit.action, "UPDATE");
    assert.deepEqual(audit.before, { left_at: "2026-10-21T08:00:00.000Z" });
    assert.equal(audit.after.correction, "left");
    assert.equal(audit.after.correction_reason, "Book says 08:30");
  });

  it("the time back, the destination and the purpose", async () => {
    const { store, run } = setup();
    store.add("m1");
    assert.equal((await run("m1", "returned", { time: "10:00" })).ok, true);
    assert.equal(store.get("m1").returnedAt!.toISOString(), "2026-10-21T09:00:00.000Z");
    // "First Bank" is close to nothing but this movement's own "Bank", which is not offered back.
    assert.equal((await run("m1", "destination", { destination: "  First   Bank " })).ok, true);
    assert.equal(store.get("m1").destination, "First Bank");
    assert.equal((await run("m1", "purpose", { purpose: "Cheque lodgement" })).ok, true);
    assert.equal(store.get("m1").purpose, "Cheque lodgement");
    assert.equal(store.audits.length, 3);
  });

  it("the approver: a roster person by the shared name rules, and a new name creates one", async () => {
    const { store, run } = setup();
    store.add("m1");
    assert.equal((await run("m1", "approver", { approver: { name: "chidi eze", personId: null, confirmNew: false } })).ok, true);
    assert.equal(store.get("m1").approvedById, "p-chidi");
    assert.match(refused(await run("m1", "approver", { approver: { name: "Chidi Ezee", personId: null, confirmNew: false } })), /close to Chidi Eze/);
    assert.equal((await run("m1", "approver", { approver: { name: "Chidi Ezee", personId: null, confirmNew: true } })).ok, true);
    assert.deepEqual(store.createdPeople.map((p) => p.name), ["Chidi Ezee"]);
    assert.ok(!JSON.stringify(store.audits).includes("Ezee"), "the audit log never carries a name");
  });

  it("the approver MAY be the person who left (marked self-approved), and cannot be already the approver", async () => {
    const { store, run } = setup();
    store.add("m1", { staffId: "p-chidi", name: "Chidi Eze" });
    assert.match(refused(await run("m1", "approver", { approver: { name: "Peter Obi", personId: null, confirmNew: false } })), /already the approver/);
    const result = await run("m1", "approver", { approver: { name: "Chidi Eze", personId: null, confirmNew: false } });
    assert.deepEqual(result, { ok: true, message: "Chidi Eze: approver changed to Chidi Eze (self-approved)." });
    assert.equal(store.get("m1").approvedById, "p-chidi");
  });

  it("no drift on a correction: case or spacing takes the existing spelling; a close one is a question", async () => {
    const { store, run } = setup();
    store.used = { destinations: ["GraceWaters Site"], purposes: ["Site inspection"] };
    store.add("m1");
    assert.equal((await run("m1", "destination", { destination: "gracewaters  site" })).ok, true);
    assert.equal(store.get("m1").destination, "GraceWaters Site");
    assert.match(refused(await run("m1", "purpose", { purpose: "Site inspecton" })), /^What for: "Site inspecton" is close to Site inspection, used before\./);
    assert.equal((await run("m1", "purpose", { purpose: "Site inspecton", purposeConfirmNew: true })).ok, true);
    assert.equal(store.get("m1").purpose, "Site inspecton");
    assert.match(refused(await run("m1", "destination", { destination: "GRACEWATERS SITE" })), /already GraceWaters Site/);
  });

  it("removing a movement entirely is a void: the row stays, with the reason", async () => {
    const { store, run } = setup();
    store.add("m1");
    const result = await run("m1", "void", { reason: "Entered twice" });
    assert.deepEqual(result, { ok: true, message: "Divine Mike's movement was removed." });
    assert.notEqual(store.get("m1").voidedAt, null);
    assert.equal(store.movements.has("m1"), true);
    assert.equal(store.get("m1").correctionReason, "Entered twice");
    assert.deepEqual(store.audits[0]!.after.voided, true);
  });
});

describe("the rules a correction cannot break", () => {
  it("the time left: after the time in, not in the future, before the return, not the same, no overlap", async () => {
    const { store, run } = setup();
    store.add("m1", { others: [{ id: "m0", leftAt: lagos(8, 0), returnedAt: lagos(8, 30) }] });
    assert.match(refused(await run("m1", "left", { time: "09:00" })), /already 09:00/);
    assert.equal(refused(await run("m1", "left", { time: "07:15" })), "Time left must be after their time in, 07:15.");
    assert.equal(refused(await run("m1", "left", { time: "10:46" })), "That time has not happened yet.");
    assert.equal(refused(await run("m1", "left", { time: "09:40" })), "Time left must be before the time they came back, 09:40.");
    assert.match(refused(await run("m1", "left", { time: "08:15" })), /another movement recorded from 08:00 to 08:30, which overlaps/);
    assert.equal((await run("m1", "left", { time: "08:45" })).ok, true);
  });

  it("the time back: after the time left, not in the future, before the time out, and only if they have come back", async () => {
    const { store, run } = setup();
    store.add("m1", { recordClockOutAt: lagos(10, 0) });
    assert.equal(refused(await run("m1", "returned", { time: "09:00" })), "Time back must be after the time they left, 09:00.");
    assert.equal(refused(await run("m1", "returned", { time: "10:46" })), "That time has not happened yet.");
    assert.equal(refused(await run("m1", "returned", { time: "10:30" })), "Time back must be before their time out, 10:00.");
    store.add("open", { returnedAt: null });
    assert.match(refused(await run("open", "returned", { time: "10:00" })), /has not come back yet/);
  });

  it("the destination and the purpose cannot be blank or unchanged", async () => {
    const { store, run } = setup();
    store.add("m1");
    assert.equal(refused(await run("m1", "destination", { destination: "   " })), "Say where they went.");
    assert.equal(refused(await run("m1", "purpose", { purpose: "" })), "Say what it was for.");
    assert.match(refused(await run("m1", "destination", { destination: "Bank" })), /already Bank/);
  });

  it("a removed movement can only be restored", async () => {
    const { store, run } = setup();
    store.add("m1", { voidedAt: lagos(9, 50) });
    for (const kind of MOVEMENT_CORRECTION_KINDS.filter((k) => k !== "restore")) {
      assert.equal(refused(await run("m1", kind, { time: "09:10", destination: "Court", purpose: "Hearing" })), "Divine Mike's movement has been removed. Restore it first to change it.", kind);
    }
  });

  it("a movement of a removed attendance record cannot be changed", async () => {
    const { store, run } = setup();
    store.add("m1", { recordVoidedAt: lagos(9, 50) });
    assert.match(refused(await run("m1", "destination", { destination: "Court" })), /attendance record has been removed/);
  });
});

describe("restoring a removed movement", () => {
  it("puts it back, with a reason, who and when", async () => {
    const { store, run } = setup();
    store.add("m1", { voidedAt: lagos(9, 50) });
    const result = await run("m1", "restore", { reason: "Removed by mistake" });
    assert.deepEqual(result, { ok: true, message: "Divine Mike's movement was restored." });
    assert.equal(store.get("m1").voidedAt, null);
    assert.equal(store.get("m1").correctedBy, ACTOR);
  });

  it("is BLOCKED if it would make the person out twice at once (an open one while another is open)", async () => {
    const { store, run } = setup();
    store.add("m1", { voidedAt: lagos(9, 50), returnedAt: null, others: [{ id: "m2", leftAt: lagos(10, 0), returnedAt: null }] });
    assert.match(refused(await run("m1", "restore")), /already recorded as out on another movement/);
    assert.notEqual(store.get("m1").voidedAt, null);
  });

  it("is BLOCKED if it would overlap another movement", async () => {
    const { store, run } = setup();
    store.add("m1", { voidedAt: lagos(9, 50), others: [{ id: "m2", leftAt: lagos(9, 20), returnedAt: lagos(9, 30) }] });
    assert.match(refused(await run("m1", "restore")), /overlaps that time/);
  });

  it("is refused for a movement that is not removed", async () => {
    const { store, run } = setup();
    store.add("m1");
    assert.match(refused(await run("m1", "restore")), /is not removed/);
  });
});

describe("a stale movement correction loses cleanly", () => {
  it("someone else changed it after she opened it: nothing written, and she is told", async () => {
    const { store, deps } = setup();
    store.add("m1");
    const seen = store.get("m1").version;
    const base = { movementId: "m1", version: seen, time: "", destination: "", purpose: "", approver: { name: "", personId: null, confirmNew: false } };
    await correctMovement({ ...base, kind: "destination", destination: "Court", reason: "B fixed it first" }, deps);
    const loser = await correctMovement({ ...base, kind: "destination", destination: "Site", reason: "A typed this second" }, deps);
    assert.equal(refused(loser), STALE_VERSION);
    assert.equal(store.get("m1").destination, "Court");
    assert.equal(store.get("m1").correctionReason, "B fixed it first");
    assert.equal(store.audits.length, 1, "no second audit row");
  });

  it("an unknown kind, or a movement that no longer exists, is a clear answer, not an error", async () => {
    const { store, run, deps } = setup();
    store.add("m1");
    assert.match(refused(await run("m1", "delete")), /not known/);
    const gone = await correctMovement({ movementId: "gone", version: "v", kind: "void", time: "", destination: "", purpose: "", approver: { name: "", personId: null, confirmNew: false }, reason: "x" }, deps);
    assert.equal(refused(gone), STALE_VERSION);
  });
});
