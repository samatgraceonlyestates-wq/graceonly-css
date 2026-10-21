// The arrival batch rules against an in-memory store whose transaction really rolls
// back. No database. Run: npm test
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  parseBatchPayload,
  saveArrivalBatch,
  type ArrivalBatchInput,
  type ArrivalRowInput,
  type ArrivalStore,
  type ArrivalTx,
  type BatchResult,
  type ExistingShift,
  type NewAttendanceRecord,
} from "./arrivalBatch.ts";
import type { RosterName } from "./rosterMatch.ts";

const ACTOR = "00000000-0000-4000-8000-0000000000a1";
// 10:45 on Wednesday 21 October 2026 in Lagos (UTC+1).
const NOW = new Date(Date.UTC(2026, 9, 21, 9, 45));
const TODAY = "2026-10-21";
const EARLIER = "2026-10-16";

interface Audit {
  actorId: string;
  entity: string;
  entityId: string;
  after: Record<string, unknown>;
}

class MemoryStore implements ArrivalStore {
  staff: RosterName[] = [];
  records: NewAttendanceRecord[] = [];
  audits: Audit[] = [];
  /** Existing shifts from "before this test", keyed by staff id. */
  history: (Omit<ExistingShift, "signoutMissing"> & { signoutMissing?: boolean })[] = [];
  created: { id: string; name: string }[] = [];
  locks: string[][] = [];
  /** Throw on the Nth createRecord (1-based), to prove a failure part-way rolls back. */
  failOnRecord: number | null = null;
  private recordCalls = 0;

  async transaction<T>(work: (tx: ArrivalTx) => Promise<T>): Promise<T> {
    const before = { staff: [...this.staff], records: [...this.records], audits: [...this.audits], created: [...this.created] };
    try {
      return await work(this.tx());
    } catch (error) {
      this.staff = before.staff;
      this.records = before.records;
      this.audits = before.audits;
      this.created = before.created;
      throw error;
    }
  }

  private tx(): ArrivalTx {
    return {
      loadRoster: async () => this.staff.map((p) => ({ ...p })),
      lockPeople: async (ids) => {
        this.locks.push([...ids]);
      },
      shiftsFor: async (ids, day) =>
        [...this.history.map((h) => ({ ...h, signoutMissing: h.signoutMissing ?? false })), ...this.records.map((r) => ({ staffId: r.staffId, clockInAt: r.clockInAt, clockOutAt: r.clockOutAt, signoutMissing: false }))].filter(
          (shift) =>
            ids.includes(shift.staffId) &&
            ((shift.clockInAt >= day.start && shift.clockInAt < day.end) || (shift.clockOutAt === null && !shift.signoutMissing)),
        ),
      createPerson: async ({ id, name }) => {
        this.staff.push({ id, name, department: null });
        this.created.push({ id, name });
      },
      createRecord: async (record) => {
        this.recordCalls += 1;
        if (this.failOnRecord === this.recordCalls) throw new Error("the database fell over");
        this.records.push(record);
      },
      audit: async (entry) => {
        this.audits.push(entry);
      },
    };
  }
}

let ids = 0;
const newId = () => `00000000-0000-4000-8000-${String((ids += 1)).padStart(12, "0")}`;

function setup(people: [string, string][] = [["1", "Divine Mike"], ["2", "Peter Obi"], ["3", "Amaka Obi"]]) {
  const store = new MemoryStore();
  store.staff = people.map(([id, name]) => ({ id: `p${id}`, name, department: null }));
  const run = (input: ArrivalBatchInput, now = NOW) => saveArrivalBatch(input, { store, actorId: ACTOR, now, newId });
  return { store, run };
}

const row = (name: string, timeIn: string, extra: Partial<ArrivalRowInput> = {}): ArrivalRowInput => ({
  name,
  personId: null,
  timeIn,
  timeOut: "",
  confirmNew: false,
  ...extra,
});
const batch = (rows: ArrivalRowInput[], date = TODAY, reason = ""): ArrivalBatchInput => ({ date, reason, rows });
const failed = (result: BatchResult) => {
  assert.equal(result.ok, false, "expected the batch to be refused");
  return result as Extract<BatchResult, { ok: false }>;
};
const untouched = (store: MemoryStore) => {
  assert.equal(store.records.length, 0, "no record was written");
  assert.equal(store.created.length, 0, "no roster person was created");
  assert.equal(store.audits.length, 0, "no audit row was written");
};

describe("good rows", () => {
  it("saves today's arrivals: known people, a new person, the signed-in user on every record", async () => {
    const { store, run } = setup();
    const result = await run(batch([row("Divine Mike", "8:15"), row("peter obi", "0830"), row("Grace Nkem", "09:05")]));
    assert.deepEqual(result, { ok: true, saved: 3, newPeople: 1, date: TODAY });
    assert.equal(store.records.length, 3);
    assert.deepEqual(store.records.map((r) => r.clockInAt.toISOString()), ["2026-10-21T07:15:00.000Z", "2026-10-21T07:30:00.000Z", "2026-10-21T08:05:00.000Z"]);
    for (const record of store.records) {
      assert.equal(record.clockInEnteredBy, ACTOR);
      assert.equal(record.clockOutAt, null, "today's arrivals are open shifts");
      assert.equal(record.clockOutEnteredBy, null);
      assert.equal(record.backdateReason, null);
    }
    assert.deepEqual(store.records.map((r) => r.staffId).slice(0, 2), ["p1", "p2"]);
  });

  it("creates the new roster person with a name only, and audits them without the name", async () => {
    const { store, run } = setup();
    await run(batch([row("Grace Nkem", "09:05")]));
    assert.equal(store.created.length, 1);
    assert.equal(store.created[0]!.name, "Grace Nkem");
    const personAudit = store.audits.find((a) => a.entity === "staff")!;
    assert.deepEqual(personAudit.after, { roster: true, via: "arrival entry" });
    assert.ok(!JSON.stringify(store.audits).includes("Grace"), "no name in the audit log");
  });

  it("writes one audit row per record, with who and what", async () => {
    const { store, run } = setup();
    await run(batch([row("Divine Mike", "08:00"), row("Peter Obi", "08:10")]));
    const audits = store.audits.filter((a) => a.entity === "attendance_record");
    assert.equal(audits.length, 2);
    assert.deepEqual(audits.map((a) => a.entityId), store.records.map((r) => r.id));
    assert.ok(audits.every((a) => a.actorId === ACTOR));
    assert.equal(audits[0]!.after.staff_id, "p1");
  });

  it("ignores blank rows, and numbers problems by the row she typed", async () => {
    const { store, run } = setup();
    const result = await run(batch([row("", ""), row("Divine Mike", "8:15"), row("", ""), row("Peter Obi", "bad")]));
    assert.equal(failed(result).problems[0]!.row, 3);
    untouched(store);
  });

  it("uses a suggestion she picked, but only while the name still matches", async () => {
    const { store, run } = setup([["1", "Divine Mike"], ["2", "Divine Mike"]]);
    // Two people share a name: picking one by id is how she tells them apart.
    const ok = await run(batch([row("Divine Mike", "08:00", { personId: "p2" })]));
    assert.equal(ok.ok, true);
    assert.equal(store.records[0]!.staffId, "p2");
    // Without the id the name alone is ambiguous.
    const { run: run2, store: store2 } = setup([["1", "Divine Mike"], ["2", "Divine Mike"]]);
    const result = failed(await run2(batch([row("Divine Mike", "08:00")])));
    assert.match(result.problems[0]!.message, /More than one person is called/);
    untouched(store2);
    // A stale id whose name was since changed is ignored, not trusted.
    const { run: run3, store: store3 } = setup();
    const stale = await run3(batch([row("Grace Nkem", "08:00", { personId: "p1" })]));
    assert.equal(stale.ok, true);
    assert.equal(store3.created.length, 1, "the typed name wins over a stale id");
  });
});

describe("the time field", () => {
  it("refuses a malformed time, against its own row and field, and writes nothing", async () => {
    const { store, run } = setup();
    for (const bad of ["815", "8:5", "8:15pm", "24:00", "", "noon"]) {
      const result = failed(await run(batch([row("Divine Mike", bad)])));
      assert.deepEqual([result.problems[0]!.row, result.problems[0]!.field], [0, "timeIn"], bad);
    }
    untouched(store);
  });

  it("refuses a time today that has not happened yet", async () => {
    const { store, run } = setup();
    const result = failed(await run(batch([row("Divine Mike", "10:46")])));
    assert.match(result.problems[0]!.message, /not happened yet/);
    assert.equal((await run(batch([row("Divine Mike", "10:45")]))).ok, true, "right now is fine");
    assert.equal(store.records.length, 1);
  });
});

describe("the day", () => {
  it("refuses a future day", async () => {
    const { store, run } = setup();
    const result = failed(await run(batch([row("Divine Mike", "08:00")], "2026-10-22")));
    assert.match(result.formProblem ?? "", /not happened yet/);
    untouched(store);
  });

  it("refuses a malformed or impossible day", async () => {
    const { store, run } = setup();
    for (const bad of ["", "21/10/2026", "2026-13-01", "2026-02-30", "yesterday"]) {
      assert.ok(failed(await run(batch([row("Divine Mike", "08:00")], bad))).formProblem, bad);
    }
    untouched(store);
  });

  it("an earlier Lagos day without a reason is refused; with one it is stored on EVERY record", async () => {
    const { store, run } = setup();
    const rows = [row("Divine Mike", "08:00", { timeOut: "17:00" }), row("Peter Obi", "08:20", { timeOut: "16:45" })];
    for (const blank of ["", "   "]) {
      const result = failed(await run(batch(rows, EARLIER, blank)));
      assert.match(result.formProblem ?? "", /Say why/);
    }
    untouched(store);
    const ok = await run(batch(rows, EARLIER, "  Copied from the book the next morning  "));
    assert.equal(ok.ok, true);
    assert.deepEqual(store.records.map((r) => r.backdateReason), ["Copied from the book the next morning", "Copied from the book the next morning"]);
  });

  it("an earlier day takes a time out (required, after the time in) and records who typed it", async () => {
    const { store, run } = setup();
    const noOut = failed(await run(batch([row("Divine Mike", "08:00")], EARLIER, "book")));
    assert.deepEqual([noOut.problems[0]!.field, noOut.problems[0]!.message], ["timeOut", "Enter a time."]);
    const before = failed(await run(batch([row("Divine Mike", "08:00", { timeOut: "07:59" })], EARLIER, "book")));
    assert.match(before.problems[0]!.message, /after time in/);
    const equal = failed(await run(batch([row("Divine Mike", "08:00", { timeOut: "8:00" })], EARLIER, "book")));
    assert.match(equal.problems[0]!.message, /after time in/);
    untouched(store);
    await run(batch([row("Divine Mike", "08:00", { timeOut: "17:00" })], EARLIER, "book"));
    const record = store.records[0]!;
    assert.equal(record.clockOutAt!.toISOString(), "2026-10-16T16:00:00.000Z");
    assert.equal(record.clockOutEnteredBy, ACTOR);
    assert.equal(record.clockInEnteredBy, ACTOR);
  });

  it("today takes no time out", async () => {
    const { store, run } = setup();
    const result = failed(await run(batch([row("Divine Mike", "08:00", { timeOut: "17:00" })])));
    assert.equal(result.problems[0]!.field, "timeOut");
    untouched(store);
  });

  it("TODAY never asks for a reason, however late in the day it is typed", async () => {
    const { store, run } = setup();
    const lateInTheDay = new Date(Date.UTC(2026, 9, 21, 21, 30)); // 22:30 in Lagos, still the 21st
    const result = await run(batch([row("Divine Mike", "08:15")], TODAY, ""), lateInTheDay);
    assert.equal(result.ok, true);
    assert.equal(store.records[0]!.backdateReason, null);
    // and a reason typed and then forgotten about is not stored against today's records
    const { store: s2, run: r2 } = setup();
    await r2(batch([row("Divine Mike", "08:15")], TODAY, "left over from another day"));
    assert.equal(s2.records[0]!.backdateReason, null);
  });

  it("'earlier' is the LAGOS day: 00:30 on the 22nd in Lagos is 23:30 UTC on the 21st", async () => {
    const { store, run } = setup();
    const justAfterLagosMidnight = new Date(Date.UTC(2026, 9, 21, 23, 30));
    const result = failed(await run(batch([row("Divine Mike", "08:00", { timeOut: "17:00" })], "2026-10-21", ""), justAfterLagosMidnight));
    assert.match(result.formProblem ?? "", /Say why/, "the 21st is already an earlier day in Lagos");
    untouched(store);
  });
});

describe("one record per person per Lagos day", () => {
  it("refuses a person who already has a record that day, naming them", async () => {
    const { store, run } = setup();
    store.history.push({ staffId: "p2", clockInAt: new Date(Date.UTC(2026, 9, 21, 7, 0)), clockOutAt: new Date(Date.UTC(2026, 9, 21, 8, 0)) });
    const result = failed(await run(batch([row("Divine Mike", "08:00"), row("Peter Obi", "08:30")])));
    assert.equal(result.problems.length, 1);
    assert.deepEqual([result.problems[0]!.row, result.problems[0]!.message], [1, "Peter Obi already has a record for 21 Oct 2026."]);
    untouched(store);
  });

  it("counts the day in Lagos: a record at 23:30 UTC on the 20th is on the 21st", async () => {
    const { store, run } = setup();
    store.history.push({ staffId: "p1", clockInAt: new Date(Date.UTC(2026, 9, 20, 23, 30)), clockOutAt: new Date(Date.UTC(2026, 9, 21, 7, 0)) });
    const result = failed(await run(batch([row("Divine Mike", "08:00")])));
    assert.match(result.problems[0]!.message, /already has a record for 21 Oct 2026/);
    untouched(store);
  });

  it("refuses the same person twice in one batch", async () => {
    const { store, run } = setup();
    const result = failed(await run(batch([row("Divine Mike", "08:00"), row("Peter Obi", "08:10"), row("divine  mike", "08:20")])));
    assert.deepEqual([result.problems[0]!.row, result.problems[0]!.message], [2, "Divine Mike is already on row 1. Each person appears once."]);
    untouched(store);
  });

  it("refuses the same NEW name twice in one batch, without creating two people", async () => {
    const { store, run } = setup();
    const result = failed(await run(batch([row("Grace Nkem", "08:00"), row("grace nkem", "08:10")])));
    assert.match(result.problems[0]!.message, /already on row 1/);
    untouched(store);
  });

  it("today's arrival is refused for someone still recorded as in from an earlier day", async () => {
    const { store, run } = setup();
    store.history.push({ staffId: "p1", clockInAt: new Date(Date.UTC(2026, 9, 19, 8, 0)), clockOutAt: null });
    const result = failed(await run(batch([row("Divine Mike", "08:00")])));
    assert.equal(result.problems[0]!.message, "Divine Mike is still recorded as in since 19 Oct 2026. Clock them out first.");
    untouched(store);
  });

  it("a person marked NEVER SIGNED OUT is not still in: they can arrive the next day (013)", async () => {
    const { store, run } = setup();
    // Monday: arrived, never signed out, marked at the end of that day.
    store.history.push({ staffId: "p1", clockInAt: new Date(Date.UTC(2026, 9, 19, 8, 0)), clockOutAt: null, signoutMissing: true });
    const result = await run(batch([row("Divine Mike", "08:00")]));
    assert.equal(result.ok, true, "a closed record without a time does not block today");
    assert.equal(store.records.length, 1);
  });

  it("but a CLOSED record for an earlier day is unaffected by someone's open shift on another day", async () => {
    const { store, run } = setup();
    store.history.push({ staffId: "p1", clockInAt: new Date(Date.UTC(2026, 9, 21, 7, 0)), clockOutAt: null });
    const result = await run(batch([row("Divine Mike", "08:00", { timeOut: "17:00" })], EARLIER, "book"));
    assert.equal(result.ok, true);
    assert.equal(store.records.length, 1);
  });

  it("locks the people it checks, in id order, before checking", async () => {
    const { store, run } = setup();
    await run(batch([row("Peter Obi", "08:00"), row("Divine Mike", "08:10"), row("Grace Nkem", "08:20")]));
    assert.deepEqual(store.locks, [["p1", "p2"]], "existing people only, sorted; the new person has nothing to lock");
  });
});

describe("a near-duplicate name needs confirming", () => {
  it('"Divine Mikel" against "Divine Mike": nothing saved, and she is asked', async () => {
    const { store, run } = setup();
    const result = failed(await run(batch([row("Divine Mikel", "08:00")])));
    assert.equal(result.problems.length, 0);
    assert.equal(result.confirmations.length, 1);
    assert.equal(result.confirmations[0]!.row, 0);
    assert.deepEqual(result.confirmations[0]!.candidates.map((c) => c.name), ["Divine Mike"]);
    untouched(store);
  });

  it("confirmed as a different person: a new roster entry is created", async () => {
    const { store, run } = setup();
    const result = await run(batch([row("Divine Mikel", "08:00", { confirmNew: true })]));
    assert.deepEqual(result, { ok: true, saved: 1, newPeople: 1, date: TODAY });
    assert.equal(store.created[0]!.name, "Divine Mikel");
    assert.notEqual(store.records[0]!.staffId, "p1");
  });

  it("confirmed once is not asked again, but other unconfirmed rows still are", async () => {
    const { store, run } = setup();
    const result = failed(await run(batch([row("Divine Mikel", "08:00", { confirmNew: true }), row("Peter Obii", "08:05")])));
    assert.deepEqual(result.confirmations.map((c) => c.row), [1]);
    untouched(store);
  });

  it("a partial name is asked about too, and picking the existing person resolves it", async () => {
    const { store, run } = setup();
    assert.equal(failed(await run(batch([row("divi", "08:00")]))).confirmations.length, 1);
    const ok = await run(batch([row("Divine Mike", "08:00", { personId: "p1" })]));
    assert.equal(ok.ok, true);
    assert.equal(store.created.length, 0);
  });

  it("two new names close to each other in one batch are asked about", async () => {
    const { store, run } = setup();
    const result = failed(await run(batch([row("Grace Nkem", "08:00"), row("Grace Nkemm", "08:05")])));
    assert.deepEqual(result.confirmations.map((c) => c.row), [1]);
    untouched(store);
  });
});

describe("all or nothing", () => {
  it("row 7 of 10 is bad: NOTHING is saved, every problem is reported, and the good rows are not half-written", async () => {
    const people: [string, string][] = Array.from({ length: 12 }, (_, i) => [String(i + 1), `Person Number${String.fromCharCode(65 + i)}${i}`]);
    const { store, run } = setup(people);
    const rows = Array.from({ length: 10 }, (_, i) => row(`Person Number${String.fromCharCode(65 + i)}${i}`, `08:${String(i).padStart(2, "0")}`));
    rows[6] = row("Person NumberG6", "8:5"); // row 7: a bad time
    rows[8] = row("Brand New Name", "08:30"); // would create a person, but must not
    const result = failed(await run(batch(rows)));
    assert.deepEqual(result.problems.map((p) => [p.row, p.field]), [[6, "timeIn"]]);
    untouched(store);
  });

  it("the database failing part-way (the 7th record) rolls back everything written before it", async () => {
    const people: [string, string][] = Array.from({ length: 10 }, (_, i) => [String(i + 1), `Person Number${String.fromCharCode(65 + i)}${i}`]);
    const { store, run } = setup(people);
    store.failOnRecord = 7;
    const rows = Array.from({ length: 10 }, (_, i) => row(`Person Number${String.fromCharCode(65 + i)}${i}`, `08:${String(i).padStart(2, "0")}`));
    rows.push(row("Brand New Name", "09:30"));
    await assert.rejects(run(batch(rows)), /fell over/);
    untouched(store);
  });
});

describe("the payload", () => {
  const good = JSON.stringify({ date: TODAY, reason: "", rows: [{ name: "A", personId: null, timeIn: "8:00", timeOut: "", confirmNew: false }] });
  it("reads the expected shape", () => {
    assert.equal(parseBatchPayload(good)?.rows.length, 1);
  });
  it("rejects anything else rather than repairing it", () => {
    for (const bad of [
      null,
      42,
      "not json",
      "[]",
      JSON.stringify({ date: TODAY, reason: "", rows: "x" }),
      JSON.stringify({ date: 5, reason: "", rows: [] }),
      JSON.stringify({ date: TODAY, reason: "", rows: [{ name: 1, personId: null, timeIn: "", timeOut: "", confirmNew: false }] }),
      JSON.stringify({ date: TODAY, reason: "", rows: [{ name: "A", personId: 7, timeIn: "", timeOut: "", confirmNew: false }] }),
      JSON.stringify({ date: TODAY, reason: "", rows: [{ name: "A", personId: null, timeIn: "", timeOut: "", confirmNew: "yes" }] }),
      JSON.stringify({ date: TODAY, reason: "", rows: Array.from({ length: 101 }, () => ({ name: "A", personId: null, timeIn: "", timeOut: "", confirmNew: false })) }),
    ]) {
      assert.equal(parseBatchPayload(bad), null);
    }
  });
});
