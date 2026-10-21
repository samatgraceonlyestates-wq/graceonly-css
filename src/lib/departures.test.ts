// Clocking people out, and marking people who never signed out, against an in-memory
// store whose transaction rolls back. No database. Run: npm test
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  clockOutPerson,
  markNoSignout,
  type DepartureDeps,
  type DepartureRecord,
  type DepartureStore,
  type DepartureTx,
} from "./departures.ts";

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

class MemoryStore implements DepartureStore {
  records = new Map<string, DepartureRecord>();
  audits: Audit[] = [];
  /** Who typed the arrival, to prove the departure can be someone else. */
  arrivalBy = new Map<string, string>();
  clockOutBy = new Map<string, string>();
  /** Pretend another front-desk user changed the record between our read and our write. */
  staleWrites = false;

  add(id: string, name: string, extra: Partial<DepartureRecord> = {}) {
    this.records.set(id, {
      id,
      staffId: `s-${id}`,
      name,
      clockInAt: lagos(21, 7, 15),
      clockOutAt: null,
      signoutMissingAt: null,
      voidedAt: null,
      clockOutByName: null,
      signoutMissingByName: null,
      hasOpenMovement: false,
      lastMovementAt: null,
      ...extra,
    });
    this.arrivalBy.set(id, "00000000-0000-4000-8000-0000000000a1");
  }

  async transaction<T>(work: (tx: DepartureTx) => Promise<T>): Promise<T> {
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

  private tx(): DepartureTx {
    return {
      lockRecords: async () => {},
      recordsByIds: async (ids) => ids.flatMap((id) => (this.records.has(id) ? [{ ...this.records.get(id)! }] : [])),
      clockOut: async ({ id, clockOutAt, actorId }) => {
        const record = this.records.get(id)!;
        if (this.staleWrites || record.clockOutAt !== null || record.signoutMissingAt !== null) return false;
        record.clockOutAt = clockOutAt;
        this.clockOutBy.set(id, actorId);
        return true;
      },
      markNoSignout: async ({ id }) => {
        const record = this.records.get(id)!;
        if (this.staleWrites || record.clockOutAt !== null || record.signoutMissingAt !== null) return null;
        record.signoutMissingAt = NOW;
        return NOW;
      },
      audit: async (entry) => {
        this.audits.push(entry);
      },
    };
  }
}

function setup() {
  const store = new MemoryStore();
  const deps: DepartureDeps = { store, actorId: ACTOR, now: NOW };
  return { store, deps };
}

describe("clocking one person out", () => {
  it("records the time out, who typed it (not necessarily who typed the arrival), and one audit row", async () => {
    const { store, deps } = setup();
    store.add("r1", "Divine Mike");
    const result = await clockOutPerson({ recordId: "r1", timeOut: "10:30" }, deps);
    assert.deepEqual(result, { ok: true, name: "Divine Mike", time: "10:30" });
    assert.equal(store.records.get("r1")!.clockOutAt!.toISOString(), "2026-10-21T09:30:00.000Z");
    assert.equal(store.clockOutBy.get("r1"), ACTOR);
    assert.notEqual(store.arrivalBy.get("r1"), ACTOR, "the arrival was typed by someone else");
    assert.equal(store.audits.length, 1);
    assert.deepEqual(store.audits[0]!.before, { clock_out_at: null, signout_missing_at: null });
    assert.equal(store.audits[0]!.after.clock_out_at, "2026-10-21T09:30:00.000Z");
    assert.equal(store.audits[0]!.actorId, ACTOR);
  });

  it("accepts 8:15, 08:15 and 0815 like the arrivals sheet, and refuses anything else", async () => {
    for (const good of ["8:30", "08:30", "0830"]) {
      const { store, deps } = setup();
      store.add("r1", "Divine Mike");
      assert.equal((await clockOutPerson({ recordId: "r1", timeOut: good }, deps)).ok, true, good);
    }
    for (const bad of ["", "815", "10:30pm", "24:00", "noon"]) {
      const { store, deps } = setup();
      store.add("r1", "Divine Mike");
      const result = await clockOutPerson({ recordId: "r1", timeOut: bad }, deps);
      assert.equal(result.ok, false, bad);
      assert.equal(store.records.get("r1")!.clockOutAt, null);
      assert.equal(store.audits.length, 0);
    }
  });

  it("refuses a time out before their time in, or equal to it, and says what the time in was", async () => {
    const { store, deps } = setup();
    store.add("r1", "Divine Mike"); // in at 07:15
    for (const early of ["07:14", "06:00", "07:15"]) {
      const result = await clockOutPerson({ recordId: "r1", timeOut: early }, deps);
      assert.deepEqual(result, { ok: false, message: "Time out must be after their time in, 07:15." }, early);
    }
    assert.equal((await clockOutPerson({ recordId: "r1", timeOut: "07:16" }, deps)).ok, true);
  });

  it("refuses a time in the future, but allows right now", async () => {
    const { store, deps } = setup();
    store.add("r1", "Divine Mike");
    const future = await clockOutPerson({ recordId: "r1", timeOut: "10:46" }, deps);
    assert.deepEqual(future, { ok: false, message: "That time has not happened yet." });
    assert.equal(store.records.get("r1")!.clockOutAt, null);
    assert.equal((await clockOutPerson({ recordId: "r1", timeOut: "10:45" }, deps)).ok, true, "right now is fine");
  });

  it("a time typed a few minutes after they left can be any earlier time after their arrival", async () => {
    const { store, deps } = setup();
    store.add("r1", "Divine Mike");
    assert.equal((await clockOutPerson({ recordId: "r1", timeOut: "09:50" }, deps)).ok, true);
    assert.equal(store.records.get("r1")!.clockOutAt!.toISOString(), "2026-10-21T08:50:00.000Z");
  });

  it("refuses someone already clocked out, or marked never signed out, or not found", async () => {
    const { store, deps } = setup();
    store.add("r1", "Gone Person", { clockOutAt: lagos(21, 9) });
    store.add("r2", "Marked Person", { signoutMissingAt: lagos(21, 9) });
    const gone = await clockOutPerson({ recordId: "r1", timeOut: "10:00" }, deps);
    assert.deepEqual(gone, { ok: false, message: "Gone Person was already clocked out at 09:00." });
    const marked = await clockOutPerson({ recordId: "r2", timeOut: "10:00" }, deps);
    assert.match(marked.ok ? "" : marked.message, /never signed out, so their record is closed/);
    const missing = await clockOutPerson({ recordId: "nope", timeOut: "10:00" }, deps);
    assert.equal(missing.ok, false);
    assert.equal(store.audits.length, 0);
  });

  it("a stale click names who got there first, and writes nothing", async () => {
    const { store, deps } = setup();
    store.add("r1", "Peter Obi", { clockOutAt: lagos(21, 10, 47), clockOutByName: "Desk B" });
    store.add("r2", "Chidi Eze", { signoutMissingAt: lagos(21, 9), signoutMissingByName: "Desk B" });
    store.add("r3", "Wrong Person", { voidedAt: lagos(21, 9) });
    const closed = await clockOutPerson({ recordId: "r1", timeOut: "10:50" }, deps);
    assert.deepEqual(closed, { ok: false, message: "Peter Obi was already clocked out at 10:47 by Desk B." });
    const marked = await clockOutPerson({ recordId: "r2", timeOut: "10:50" }, deps);
    assert.equal(marked.ok ? "" : marked.message, "Chidi Eze was marked as never signed out by Desk B, so their record is closed.");
    const removed = await clockOutPerson({ recordId: "r3", timeOut: "10:50" }, deps);
    assert.equal(removed.ok ? "" : removed.message, "Wrong Person's record has been removed.");
    assert.equal(store.audits.length, 0, "no second write");
    assert.equal(store.records.get("r1")!.clockOutAt!.toISOString(), "2026-10-21T09:47:00.000Z", "the first clock-out is untouched");
  });

  it("refuses while they are out on a movement, and before a movement that ended later", async () => {
    const { store, deps } = setup();
    store.add("r1", "Out Person", { hasOpenMovement: true, lastMovementAt: lagos(21, 10) });
    const out = await clockOutPerson({ recordId: "r1", timeOut: "10:30" }, deps);
    assert.match(out.ok ? "" : out.message, /out on a movement\. Record their return first/);

    store.add("r2", "Back Person", { lastMovementAt: lagos(21, 10, 20) }); // returned 10:20
    const before = await clockOutPerson({ recordId: "r2", timeOut: "10:00" }, deps);
    assert.deepEqual(before, { ok: false, message: "Back Person has a movement recorded until 10:20, after that time." });
    assert.equal((await clockOutPerson({ recordId: "r2", timeOut: "10:20" }, deps)).ok, true, "after the movement ended is fine");
  });

  it("an earlier day's open shift takes its time out on THAT day", async () => {
    const { store, deps } = setup();
    store.add("r1", "Forgot Person", { clockInAt: lagos(19, 8) }); // Monday 19th
    const result = await clockOutPerson({ recordId: "r1", timeOut: "17:00" }, deps);
    assert.equal(result.ok, true);
    assert.equal(store.records.get("r1")!.clockOutAt!.toISOString(), "2026-10-19T16:00:00.000Z");
    // and "before the time in" is judged on that day too
    store.add("r2", "Forgot Too", { clockInAt: lagos(19, 8) });
    assert.equal((await clockOutPerson({ recordId: "r2", timeOut: "07:30" }, deps)).ok, false);
  });

  it("if the record changed under her (a guarded write finds nothing), it says so and writes no audit", async () => {
    const { store, deps } = setup();
    store.add("r1", "Divine Mike");
    store.staleWrites = true;
    const result = await clockOutPerson({ recordId: "r1", timeOut: "10:30" }, deps);
    assert.deepEqual(result, { ok: false, message: "That record has changed. Reload the page and look again." });
    assert.equal(store.audits.length, 0);
  });
});

describe("marking people who never signed out (013)", () => {
  it("marks exactly the people she chose, one audit row each, and leaves everyone else IN", async () => {
    const { store, deps } = setup();
    store.add("r1", "Ada");
    store.add("r2", "Bola");
    store.add("r3", "Chidi");
    const result = await markNoSignout({ recordIds: ["r1", "r3"] }, deps);
    assert.deepEqual(result, { ok: true, marked: 2, skipped: [] });
    assert.notEqual(store.records.get("r1")!.signoutMissingAt, null);
    assert.equal(store.records.get("r2")!.signoutMissingAt, null, "not chosen, so not touched");
    assert.notEqual(store.records.get("r3")!.signoutMissingAt, null);
    assert.equal(store.audits.length, 2);
    assert.equal(store.audits[0]!.after.via, "end of day");
  });

  it("never gives the marked shift a clock-out time: its hours stay unknown", async () => {
    const { store, deps } = setup();
    store.add("r1", "Ada");
    await markNoSignout({ recordIds: ["r1"] }, deps);
    assert.equal(store.records.get("r1")!.clockOutAt, null);
  });

  it("does nothing by itself: no ids, no marks", async () => {
    const { store, deps } = setup();
    store.add("r1", "Ada");
    const result = await markNoSignout({ recordIds: [] }, deps);
    assert.equal(result.ok, false);
    assert.equal(store.records.get("r1")!.signoutMissingAt, null);
  });

  it("skips, with the reason, anyone already closed, already marked, or out on a movement", async () => {
    const { store, deps } = setup();
    store.add("r1", "Gone", { clockOutAt: lagos(21, 9) });
    store.add("r2", "Marked", { signoutMissingAt: lagos(20, 18) });
    store.add("r3", "Out", { hasOpenMovement: true });
    store.add("r4", "Still In");
    const result = await markNoSignout({ recordIds: ["r1", "r2", "r3", "r4"] }, deps);
    assert.ok(result.ok);
    if (result.ok) {
      assert.equal(result.marked, 1);
      assert.deepEqual(result.skipped.map((s) => [s.name, s.reason]).sort(), [
        ["Gone", "already clocked out"],
        ["Marked", "already marked as never signed out"],
        ["Out", "out on a movement: record their return first"],
      ]);
    }
    assert.equal(store.audits.length, 1);
  });

  it("counts each person once even if listed twice, and reports one who cannot be found", async () => {
    const { store, deps } = setup();
    store.add("r1", "Ada");
    const result = await markNoSignout({ recordIds: ["r1", "r1", "ghost"] }, deps);
    assert.ok(result.ok);
    if (result.ok) {
      assert.equal(result.marked, 1);
      assert.equal(result.skipped.length, 1);
    }
  });

  it("a record changed by someone else a moment ago is skipped, not overwritten", async () => {
    const { store, deps } = setup();
    store.add("r1", "Ada");
    store.staleWrites = true;
    const result = await markNoSignout({ recordIds: ["r1"] }, deps);
    assert.ok(result.ok);
    if (result.ok) assert.deepEqual([result.marked, result.skipped[0]!.reason], [0, "changed a moment ago"]);
    assert.equal(store.audits.length, 0);
  });

  it("refuses an absurd number at once", async () => {
    const { deps } = setup();
    const result = await markNoSignout({ recordIds: Array.from({ length: 201 }, (_, i) => `r${i}`) }, deps);
    assert.equal(result.ok, false);
  });
});
