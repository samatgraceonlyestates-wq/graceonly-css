// The correction rules against an in-memory store that keeps a version per record and
// rolls back. No database. Run: npm test
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ARRIVAL_ROLES } from "./arrivalBatch.ts";
import {
  CORRECTION_KINDS,
  NEEDS_REASON,
  STALE_VERSION,
  correctRecord,
  type Correction,
  type CorrectionDeps,
  type CorrectionInput,
  type CorrectionRecord,
  type CorrectionStore,
  type CorrectionTx,
} from "./corrections.ts";

const ACTOR = "00000000-0000-4000-8000-0000000000b2";
// 10:45 on Wednesday 21 October 2026 in Lagos (UTC+1).
const NOW = new Date(Date.UTC(2026, 9, 21, 9, 45));
const lagos = (day: number, hour: number, minute = 0) => new Date(Date.UTC(2026, 9, day, hour - 1, minute));

interface Audit {
  actorId: string;
  entityId: string;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
}

interface Stored extends CorrectionRecord {
  correctedBy: string | null;
  correctionReason: string | null;
  clockOutEnteredBy: string | null;
}

class MemoryStore implements CorrectionStore {
  records = new Map<string, Stored>();
  audits: Audit[] = [];
  /** Pretend another front-desk user changes the record between our read and our write. */
  loseTheRace = false;
  private counter = 0;

  add(id: string, name: string, extra: Partial<Stored> = {}) {
    this.records.set(id, {
      id,
      staffId: `s-${name}`,
      name,
      clockInAt: lagos(21, 7, 15),
      clockOutAt: null,
      signoutMissingAt: null,
      voidedAt: null,
      version: `v${(this.counter += 1)}`,
      movementCount: 0,
      firstMovementAt: null,
      lastMovementAt: null,
      otherOpenSince: null,
      correctedBy: null,
      correctionReason: null,
      clockOutEnteredBy: null,
      ...extra,
    });
  }

  get(id: string): Stored {
    return this.records.get(id)!;
  }

  async transaction<T>(work: (tx: CorrectionTx) => Promise<T>): Promise<T> {
    const snapshot = new Map([...this.records].map(([id, r]) => [id, { ...r }]));
    const audits = [...this.audits];
    try {
      return await work(this.tx());
    } catch (error) {
      this.records = snapshot;
      this.audits = audits;
      throw error;
    }
  }

  private tx(): CorrectionTx {
    return {
      lock: async () => {},
      hasOtherLiveRecordOnDay: async (id, day) => {
        const record = this.records.get(id)!;
        return [...this.records.values()].some(
          (o) => o.id !== id && o.staffId === record.staffId && o.voidedAt === null && o.clockInAt >= day.start && o.clockInAt < day.end,
        );
      },
      find: async (id) => {
        const record = this.records.get(id);
        if (record === undefined) return null;
        // "Another live open shift of the same person", worked out from the other records.
        const other = [...this.records.values()].find(
          (o) => o.staffId === record.staffId && o.id !== record.id && o.clockOutAt === null && o.signoutMissingAt === null && o.voidedAt === null,
        );
        return { ...record, otherOpenSince: other ? other.clockInAt : record.otherOpenSince };
      },
      apply: async ({ id, version, actorId, reason, correction }) => {
        const record = this.records.get(id)!;
        if (this.loseTheRace || record.version !== version || (correction.kind !== "restore" && record.voidedAt !== null)) return false;
        this.change(record, correction, actorId);
        record.correctedAt = NOW;
        record.correctedBy = actorId;
        record.correctionReason = reason;
        record.version = `v${(this.counter += 1)}`;
        return true;
      },
      audit: async (entry) => {
        this.audits.push(entry);
      },
    };
  }

  private change(record: Stored, correction: Correction, actorId: string) {
    switch (correction.kind) {
      case "arrival":
        record.clockInAt = correction.clockInAt;
        break;
      case "departure":
        record.clockOutAt = correction.clockOutAt;
        record.clockOutEnteredBy ??= actorId;
        record.signoutMissingAt = null;
        break;
      case "reopen":
        record.clockOutAt = null;
        record.clockOutEnteredBy = null;
        break;
      case "unmark":
        record.signoutMissingAt = null;
        break;
      case "void":
        record.voidedAt = NOW;
        break;
      case "restore":
        record.voidedAt = null;
        break;
    }
  }
}

// CorrectionRecord has no correctedAt, but the store keeps one for the assertions below.
declare module "./corrections.ts" {
  interface CorrectionRecord {
    correctedAt?: Date | null;
  }
}

function setup() {
  const store = new MemoryStore();
  const deps: CorrectionDeps = { store, actorId: ACTOR, now: NOW };
  const run = (id: string, kind: string, extra: Partial<CorrectionInput> = {}) =>
    correctRecord({ recordId: id, version: store.get(id).version, kind, time: "", reason: "The book says so", ...extra }, deps);
  return { store, deps, run };
}

const refused = (result: { ok: boolean; message: string }) => {
  assert.equal(result.ok, false, "expected the correction to be refused");
  return result.message;
};

describe("EVERY correction needs a reason", () => {
  it("is refused for all five kinds when the reason is missing, blank or only spaces, and nothing changes", async () => {
    for (const kind of CORRECTION_KINDS) {
      for (const reason of ["", "   ", "\n\t"]) {
        const { store, run } = setup();
        store.add("r1", "Divine Mike", { clockOutAt: lagos(21, 9), clockOutEnteredBy: "x", signoutMissingAt: null });
        const before = JSON.stringify(store.get("r1"));
        const message = refused(await run("r1", kind, { time: "08:30", reason }));
        assert.equal(message, NEEDS_REASON, `${kind} / ${JSON.stringify(reason)}`);
        assert.equal(JSON.stringify(store.get("r1")), before, "the record is untouched");
        assert.equal(store.audits.length, 0, "no audit row");
      }
    }
  });

  it("there is no default text: the stored reason is exactly what was typed (trimmed)", async () => {
    const { store, run } = setup();
    store.add("r1", "Divine Mike");
    await run("r1", "arrival", { time: "08:30", reason: "  Book says 08:30  " });
    assert.equal(store.get("r1").correctionReason, "Book says 08:30");
  });

  it("is checked before anything else is read: even an unknown record gets the reason message first", async () => {
    const { deps } = setup();
    const result = await correctRecord({ recordId: "nope", version: "v", kind: "arrival", time: "08:00", reason: "" }, deps);
    assert.equal(refused(result), NEEDS_REASON);
  });

  it("refuses an over-long reason", async () => {
    const { store, run } = setup();
    store.add("r1", "Divine Mike");
    assert.match(refused(await run("r1", "arrival", { time: "08:30", reason: "x".repeat(501) })), /under 500/);
  });

  it("FRONT_DESK and ADMIN can both correct: the gate is the reason, not a role", () => {
    assert.deepEqual([...ARRIVAL_ROLES].sort(), ["ADMIN", "FRONT_DESK"]);
  });
});

describe("every correction records who, when and why, and one audit row with before and after", () => {
  it("a time in change", async () => {
    const { store, run } = setup();
    store.add("r1", "Divine Mike"); // in at 07:15
    const result = await run("r1", "arrival", { time: "0630", reason: "Book says 06:30" });
    assert.deepEqual(result, { ok: true, message: "Divine Mike: time in changed from 07:15 to 06:30." });
    const record = store.get("r1");
    assert.equal(record.clockInAt.toISOString(), "2026-10-21T05:30:00.000Z");
    assert.equal(record.correctedBy, ACTOR);
    assert.equal(record.correctionReason, "Book says 06:30");
    assert.notEqual(record.correctedAt, null);
    assert.equal(store.audits.length, 1);
    const audit = store.audits[0]!;
    assert.equal(audit.actorId, ACTOR);
    assert.deepEqual(audit.before, { clock_in_at: "2026-10-21T06:15:00.000Z" });
    assert.equal(audit.after.clock_in_at, "2026-10-21T05:30:00.000Z");
    assert.equal(audit.after.correction_reason, "Book says 06:30");
    assert.equal(audit.after.correction, "arrival");
    assert.equal(audit.after.via, "correction");
  });

  it("changes the version, so a screen holding the old one can tell", async () => {
    const { store, run } = setup();
    store.add("r1", "Divine Mike");
    const before = store.get("r1").version;
    await run("r1", "arrival", { time: "06:30" });
    assert.notEqual(store.get("r1").version, before);
  });
});

describe("a time in correction", () => {
  it("is refused when it is the same time, in the future, malformed, or not before the time out", async () => {
    const { store, run } = setup();
    store.add("r1", "Divine Mike", { clockOutAt: lagos(21, 9), clockOutEnteredBy: "x" }); // 07:15 to 09:00
    assert.match(refused(await run("r1", "arrival", { time: "07:15" })), /already 07:15/);
    assert.match(refused(await run("r1", "arrival", { time: "815pm" })), /Type the time as/);
    assert.equal(refused(await run("r1", "arrival", { time: "09:00" })), "Time in must be before their time out, 09:00.");
    assert.equal(refused(await run("r1", "arrival", { time: "09:30" })), "Time in must be before their time out, 09:00.");
    const open = setup();
    open.store.add("r2", "Open Person");
    assert.equal(refused(await open.run("r2", "arrival", { time: "10:46" })), "That time has not happened yet.");
    assert.equal(store.audits.length, 0);
  });

  it("must keep a movement inside the shift", async () => {
    const { store, run } = setup();
    store.add("r1", "Divine Mike", { movementCount: 1, firstMovementAt: lagos(21, 8), lastMovementAt: lagos(21, 8, 30) });
    assert.match(refused(await run("r1", "arrival", { time: "08:10" })), /movement recorded from 08:00, before that time/);
    assert.equal((await run("r1", "arrival", { time: "07:45" })).ok, true);
  });

  it("is on the record's own Lagos day: an earlier day's record stays on that day", async () => {
    const { store, run } = setup();
    store.add("r1", "Forgot Person", { clockInAt: lagos(19, 8) });
    assert.equal((await run("r1", "arrival", { time: "07:30" })).ok, true);
    assert.equal(store.get("r1").clockInAt.toISOString(), "2026-10-19T06:30:00.000Z");
  });
});

describe("a time out correction", () => {
  it("changes a recorded time out, keeping who typed the original", async () => {
    const { store, run } = setup();
    store.add("r1", "Divine Mike", { clockOutAt: lagos(21, 9), clockOutEnteredBy: "desk-a" });
    const result = await run("r1", "departure", { time: "09:40" });
    assert.deepEqual(result, { ok: true, message: "Divine Mike: time out changed from 09:00 to 09:40." });
    assert.equal(store.get("r1").clockOutAt!.toISOString(), "2026-10-21T08:40:00.000Z");
    assert.equal(store.get("r1").clockOutEnteredBy, "desk-a", "the original author is kept: the corrector is in corrected_by");
    assert.equal(store.get("r1").correctedBy, ACTOR);
  });

  it("gives a time to a shift marked never signed out, and clears the mark", async () => {
    const { store, run } = setup();
    store.add("r1", "Chidi Eze", { signoutMissingAt: lagos(20, 18) });
    const result = await run("r1", "departure", { time: "10:00" });
    assert.equal(result.ok, true);
    const record = store.get("r1");
    assert.equal(record.clockOutAt!.toISOString(), "2026-10-21T09:00:00.000Z");
    assert.equal(record.signoutMissingAt, null);
    assert.equal(record.clockOutEnteredBy, ACTOR, "she typed this time");
  });

  it("is refused for a shift that is still open (that is Clock out), before the time in, in the future, same time, or before a movement ended", async () => {
    const { store, run } = setup();
    store.add("open", "Open Person");
    assert.match(refused(await run("open", "departure", { time: "10:00" })), /Use Clock out/);
    store.add("r1", "Divine Mike", { clockOutAt: lagos(21, 9), clockOutEnteredBy: "x", lastMovementAt: lagos(21, 8, 45), movementCount: 1, firstMovementAt: lagos(21, 8, 30) });
    assert.equal(refused(await run("r1", "departure", { time: "07:15" })), "Time out must be after their time in, 07:15.");
    assert.equal(refused(await run("r1", "departure", { time: "07:00" })), "Time out must be after their time in, 07:15.");
    assert.equal(refused(await run("r1", "departure", { time: "10:46" })), "That time has not happened yet.");
    assert.match(refused(await run("r1", "departure", { time: "09:00" })), /already 09:00/);
    assert.match(refused(await run("r1", "departure", { time: "08:40" })), /movement recorded until 08:45, after that time/);
    assert.equal(store.audits.length, 0);
  });
});

describe("reopening a shift", () => {
  it("undoes a clock-out: the shift is open again, with no clock-out author", async () => {
    const { store, run } = setup();
    store.add("r1", "Divine Mike", { clockOutAt: lagos(21, 9), clockOutEnteredBy: "desk-a" });
    const result = await run("r1", "reopen");
    assert.deepEqual(result, { ok: true, message: "Divine Mike is back in: the clock-out was undone." });
    assert.equal(store.get("r1").clockOutAt, null);
    assert.equal(store.get("r1").clockOutEnteredBy, null);
    assert.deepEqual(store.audits[0]!.before, { clock_out_at: "2026-10-21T08:00:00.000Z" });
    assert.deepEqual(store.audits[0]!.after.clock_out_at, null);
  });

  it("is BLOCKED by an existing open shift, and says so clearly", async () => {
    const { store, run } = setup();
    // Yesterday's record was closed; the person arrived again today and is still in.
    store.add("old", "Divine Mike", { clockInAt: lagos(20, 8), clockOutAt: lagos(20, 17), clockOutEnteredBy: "x" });
    store.add("today", "Divine Mike", { clockInAt: lagos(21, 8) });
    const message = refused(await run("old", "reopen"));
    assert.equal(message, "Divine Mike is already recorded as in since 21 Oct 2026, and a person can have only one open shift. Clock that one out first.");
    assert.notEqual(store.get("old").clockOutAt, null, "nothing was reopened");
    assert.equal(store.audits.length, 0);
  });

  it("a removed (voided) open shift does not block it", async () => {
    const { store, run } = setup();
    store.add("old", "Divine Mike", { clockInAt: lagos(20, 8), clockOutAt: lagos(20, 17), clockOutEnteredBy: "x" });
    store.add("wrong", "Divine Mike", { clockInAt: lagos(21, 8), voidedAt: lagos(21, 9) });
    assert.equal((await run("old", "reopen")).ok, true);
  });

  it("is refused for a shift that has no clock-out", async () => {
    const { store, run } = setup();
    store.add("r1", "Divine Mike");
    assert.match(refused(await run("r1", "reopen")), /no clock-out to undo/);
  });
});

describe("unmarking a never-signed-out shift", () => {
  it("puts it back to still in", async () => {
    const { store, run } = setup();
    store.add("r1", "Chidi Eze", { signoutMissingAt: lagos(20, 18) });
    const result = await run("r1", "unmark");
    assert.equal(result.ok, true);
    assert.equal(store.get("r1").signoutMissingAt, null);
    assert.equal(store.get("r1").clockOutAt, null, "open again, not closed with a made-up time");
  });

  it("is blocked by an existing open shift, like reopening", async () => {
    const { store, run } = setup();
    store.add("old", "Chidi Eze", { clockInAt: lagos(19, 8), signoutMissingAt: lagos(19, 18) });
    store.add("today", "Chidi Eze", { clockInAt: lagos(21, 8) });
    assert.match(refused(await run("old", "unmark")), /already recorded as in since 21 Oct 2026/);
    assert.notEqual(store.get("old").signoutMissingAt, null);
  });

  it("is refused for a record that is not marked", async () => {
    const { store, run } = setup();
    store.add("r1", "Chidi Eze");
    assert.match(refused(await run("r1", "unmark")), /not marked as never signed out/);
  });
});

describe("removing a record entered for the wrong person (a void, not a delete)", () => {
  it("keeps the row, marks it removed with the reason, and writes the audit row", async () => {
    const { store, run } = setup();
    store.add("r1", "Wrong Person");
    const result = await run("r1", "void", { reason: "Entered for the wrong person" });
    assert.deepEqual(result, { ok: true, message: "Wrong Person's record was removed." });
    assert.equal(store.records.has("r1"), true, "the row is still there");
    assert.notEqual(store.get("r1").voidedAt, null);
    assert.equal(store.get("r1").correctionReason, "Entered for the wrong person");
    assert.equal(store.get("r1").correctedBy, ACTOR);
    assert.deepEqual(store.audits[0]!.before, { voided: false });
    assert.equal(store.audits[0]!.after.voided, true);
  });

  it("a removed record cannot be corrected or removed again (only restored)", async () => {
    const { store, deps } = setup();
    store.add("r1", "Wrong Person", { voidedAt: lagos(21, 9) });
    for (const kind of CORRECTION_KINDS.filter((k) => k !== "restore")) {
      const result = await correctRecord({ recordId: "r1", version: store.get("r1").version, kind, time: "08:00", reason: "x" }, deps);
      assert.equal(refused(result), "Wrong Person's record has been removed. Restore it first to change it.", kind);
    }
  });

  it("is refused while movements are recorded against the record", async () => {
    const { store, run } = setup();
    store.add("r1", "Divine Mike", { movementCount: 2 });
    assert.match(refused(await run("r1", "void")), /movements recorded against this record/);
    assert.equal(store.get("r1").voidedAt, null);
  });
});

describe("restoring a removed record (the way back)", () => {
  it("puts it back, with a reason, who and when, and one audit row", async () => {
    const { store, run } = setup();
    store.add("r1", "Divine Mike", { voidedAt: lagos(21, 9) });
    const result = await run("r1", "restore", { reason: "Removed by mistake" });
    assert.deepEqual(result, { ok: true, message: "Divine Mike's record was restored." });
    assert.equal(store.get("r1").voidedAt, null);
    assert.equal(store.get("r1").correctionReason, "Removed by mistake");
    assert.equal(store.get("r1").correctedBy, ACTOR);
    assert.deepEqual(store.audits[0]!.before, { voided: true });
    assert.deepEqual(store.audits[0]!.after.voided, false);
    assert.equal(store.audits[0]!.after.correction, "restore");
  });

  it("needs a reason like every other correction", async () => {
    const { store, run } = setup();
    store.add("r1", "Divine Mike", { voidedAt: lagos(21, 9) });
    assert.equal(refused(await run("r1", "restore", { reason: "  " })), NEEDS_REASON);
    assert.notEqual(store.get("r1").voidedAt, null);
  });

  it("is BLOCKED by the one-open-shift rule: the person is in again, and this record would be a second open shift", async () => {
    const { store, run } = setup();
    store.add("removed", "Divine Mike", { clockInAt: lagos(20, 8), voidedAt: lagos(20, 9) }); // open, from Monday
    store.add("today", "Divine Mike", { clockInAt: lagos(21, 8) });
    assert.equal(
      refused(await run("removed", "restore")),
      "Divine Mike is already recorded as in since 21 Oct 2026, and a person can have only one open shift. Clock that one out first.",
    );
    assert.notEqual(store.get("removed").voidedAt, null);
    assert.equal(store.audits.length, 0);
  });

  it("is BLOCKED by the one-record-a-day rule, naming the day", async () => {
    const { store, run } = setup();
    // The wrong record was removed and the right one entered for the same day; restoring would give two.
    store.add("removed", "Divine Mike", { clockInAt: lagos(21, 8), clockOutAt: lagos(21, 9), voidedAt: lagos(21, 9) });
    store.add("entered-again", "Divine Mike", { clockInAt: lagos(21, 7), clockOutAt: lagos(21, 8) });
    assert.equal(refused(await run("removed", "restore")), "Divine Mike already has a record for 21 Oct 2026, so this one cannot be restored.");
  });

  it("a CLOSED removed record is not blocked by an open shift on another day", async () => {
    const { store, run } = setup();
    store.add("removed", "Divine Mike", { clockInAt: lagos(20, 8), clockOutAt: lagos(20, 17), clockOutEnteredBy: "x", voidedAt: lagos(20, 18) });
    store.add("today", "Divine Mike", { clockInAt: lagos(21, 8) });
    assert.equal((await run("removed", "restore")).ok, true);
  });

  it("is refused for a record that is not removed, and a stale version loses cleanly", async () => {
    const { store, run, deps } = setup();
    store.add("live", "Divine Mike");
    assert.match(refused(await run("live", "restore")), /is not removed/);
    store.add("r1", "Peter Obi", { voidedAt: lagos(21, 9) });
    const seen = store.get("r1").version;
    await correctRecord({ recordId: "r1", version: seen, kind: "restore", time: "", reason: "first" }, deps);
    store.get("r1").voidedAt = lagos(21, 9); // removed again by someone else
    assert.equal(refused(await correctRecord({ recordId: "r1", version: seen, kind: "restore", time: "", reason: "second" }, deps)), STALE_VERSION);
  });
});

describe("a stale correction loses cleanly", () => {
  it("someone else changed the record after she opened it: nothing is written, and she is told", async () => {
    const { store, deps } = setup();
    store.add("r1", "Divine Mike");
    const seen = store.get("r1").version;
    // The other front-desk user corrects it first.
    await correctRecord({ recordId: "r1", version: seen, kind: "arrival", time: "06:30", reason: "Book says 06:30" }, deps);
    const loser = await correctRecord({ recordId: "r1", version: seen, kind: "arrival", time: "07:00", reason: "Typo" }, deps);
    assert.equal(refused(loser), STALE_VERSION);
    assert.equal(store.get("r1").clockInAt.toISOString(), "2026-10-21T05:30:00.000Z", "the first correction stands");
    assert.equal(store.get("r1").correctionReason, "Book says 06:30");
    assert.equal(store.audits.length, 1, "no second audit row");
  });

  it("the guarded write finding nothing to update (a lost race) is the same clear answer, with no audit row", async () => {
    const { store, run } = setup();
    store.add("r1", "Divine Mike");
    store.loseTheRace = true;
    assert.equal(refused(await run("r1", "arrival", { time: "06:30" })), STALE_VERSION);
    assert.equal(store.audits.length, 0);
  });

  it("a record that no longer exists, or no version, is the same answer, not an error", async () => {
    const { deps } = setup();
    assert.equal(refused(await correctRecord({ recordId: "gone", version: "v1", kind: "void", time: "", reason: "x" }, deps)), STALE_VERSION);
    assert.equal(refused(await correctRecord({ recordId: "r1", version: "", kind: "void", time: "", reason: "x" }, deps)), STALE_VERSION);
  });

  it("an unknown kind is refused without touching anything", async () => {
    const { store, run } = setup();
    store.add("r1", "Divine Mike");
    assert.match(refused(await run("r1", "delete")), /not known/);
  });
});
