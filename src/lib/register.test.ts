// Screen 08's rules, above all the hours: a period with shifts that have NO SIGN-OUT, a shift
// left OPEN from an earlier day, a REMOVED record and one still IN PROGRESS today. No database.
// Run: npm test
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildRegister,
  daysIn,
  honestyNote,
  isLate,
  knownHoursMs,
  parseLateAfter,
  parsePeriod,
  shiftKind,
  totalsOf,
  type RegisterRecord,
} from "./register.ts";

// Monday 26 October 2026 is TODAY in Lagos (UTC+1). The period is the week before and today.
const TODAY = "2026-10-26";
const at = (day: number, hour: number, minute = 0) => new Date(Date.UTC(2026, 9, day, hour - 1, minute));
const H = 3_600_000;

let n = 0;
const record = (staffId: string, extra: Partial<RegisterRecord> = {}): RegisterRecord => ({
  id: `r${(n += 1)}`,
  staffId,
  name: { a: "Ada Okafor", b: "Bola Ade", c: "Chidi Eze", d: "Dayo Cole" }[staffId] ?? staffId,
  department: { a: "Legal", b: "Finance", c: "Legal", d: null }[staffId] ?? null,
  clockInAt: at(19, 8),
  clockOutAt: at(19, 17),
  signoutMissingAt: null,
  voidedAt: null,
  clockInByName: "Desk A",
  clockOutByName: "Desk A",
  signoutMissingByName: null,
  backdateReason: null,
  correctedAt: null,
  correctedByName: null,
  correctionReason: null,
  restoredAt: null,
  restoredByName: null,
  restoredReason: null,
  movements: 0,
  selfApprovedMovements: 0,
  ...extra,
});

/** A MESSY week: not a clean one. */
function messyWeek(): RegisterRecord[] {
  return [
    // Ada: a complete 9h shift, on time; then one with NO SIGN-OUT, late.
    record("a", { clockInAt: at(19, 8), clockOutAt: at(19, 17) }),
    record("a", { clockInAt: at(20, 9, 30), clockOutAt: null, signoutMissingAt: at(20, 20), signoutMissingByName: "Desk B", clockOutByName: null }),
    // Bola: a complete 8h shift, one minute late, typed in by A and out by B; then a shift NEVER CLOSED (open since the 22nd).
    record("b", { clockInAt: at(21, 9, 16), clockOutAt: at(21, 17, 16), clockOutByName: "Desk B" }),
    record("b", { clockInAt: at(22, 8, 30), clockOutAt: null, clockOutByName: null }),
    // Chidi: IN PROGRESS today; and a REMOVED 10h record, which must count for nothing.
    record("c", { clockInAt: at(26, 8), clockOutAt: null, clockOutByName: null }),
    record("c", { clockInAt: at(23, 7), clockOutAt: at(23, 17), voidedAt: at(23, 18), correctedAt: at(23, 18), correctedByName: "Desk B", correctionReason: "Wrong person" }),
    // Dayo (no department): in at exactly 09:15 (not late: late is AFTER), 7h, corrected and restored.
    record("d", {
      clockInAt: at(23, 9, 15),
      clockOutAt: at(23, 16, 15),
      correctedAt: at(24, 10),
      correctedByName: "Desk B",
      correctionReason: "Removed by mistake",
      restoredAt: at(24, 10),
      restoredByName: "Desk B",
      restoredReason: "Removed by mistake",
    }),
  ];
}

describe("the four kinds of shift", () => {
  it("complete, no sign-out, open from an earlier day, in progress today", () => {
    assert.equal(shiftKind({ clockInAt: at(19, 8), clockOutAt: at(19, 17), signoutMissingAt: null }, TODAY), "complete");
    assert.equal(shiftKind({ clockInAt: at(20, 8), clockOutAt: null, signoutMissingAt: at(20, 20) }, TODAY), "noSignout");
    assert.equal(shiftKind({ clockInAt: at(25, 23, 59), clockOutAt: null, signoutMissingAt: null }, TODAY), "openEarlier", "yesterday, still open: never closed");
    assert.equal(shiftKind({ clockInAt: at(26, 0, 1), clockOutAt: null, signoutMissingAt: null }, TODAY), "inProgress");
  });

  it("hours are known ONLY for a complete shift: an unknown is null, never zero, never run up to now", () => {
    assert.equal(knownHoursMs({ clockInAt: at(19, 8), clockOutAt: at(19, 17), signoutMissingAt: null }), 9 * H);
    assert.equal(knownHoursMs({ clockInAt: at(20, 8), clockOutAt: null, signoutMissingAt: at(20, 20) }), null);
    assert.equal(knownHoursMs({ clockInAt: at(22, 8), clockOutAt: null, signoutMissingAt: null }), null);
  });
});

describe("the totals of a messy period", () => {
  const totals = totalsOf(messyWeek(), TODAY, "09:15");

  it("a removed record is in no count", () => {
    assert.equal(totals.shifts, 6, "seven rows, one removed");
    assert.equal(totals.people, 4);
    assert.equal(totals.knownMs, (9 + 8 + 7) * H, "the removed 10h shift is not in the total");
  });

  it("the total is the COMPLETE shifts only, and the unknowns are their own count beside it", () => {
    assert.equal(totals.complete, 3);
    assert.equal(totals.noSignout, 1);
    assert.equal(totals.openEarlier, 1, "the shift open since the 22nd is not completed");
    assert.equal(totals.inProgress, 1);
    assert.equal(totals.unknown, 2, "no sign-out and never closed are both unknown; in progress is not");
    assert.equal(totals.complete + totals.unknown + totals.inProgress, totals.shifts, "every shift is accounted for exactly once");
  });

  it("late is by the setting, strictly after it, on the record's own day", () => {
    assert.equal(totals.late, 2, "09:30 and 09:16 are late; 09:15 exactly is not");
    assert.equal(totalsOf(messyWeek(), TODAY, "09:00").late, 3, "a different setting gives a different answer: it is not a constant");
    assert.equal(totalsOf(messyWeek(), TODAY, null).late, null, "no rule: lateness unknown, not zero");
  });

  it("counts corrections, restores and movements; a removed record's correction is not among them", () => {
    assert.equal(totals.corrected, 1);
    assert.equal(totals.restored, 1);
  });

  it("the note says how much is unaccounted for, and says it plainly when it is a lot", () => {
    const note = honestyNote(totals)!;
    assert.equal(note.serious, true, "2 of 6 is a third");
    assert.match(note.text, /^2 of 6 shifts have unknown hours \(1 with no sign-out, 1 never closed\)\./);
    assert.match(note.text, /covers only the 3 completed shifts: it is a minimum, not the hours worked/);
    assert.match(note.text, /1 shift is still in progress today and not in the total yet/);
    assert.match(note.text, /the total says little about the period/);
  });

  it("a little unknown is stated but not called serious; nothing unknown says nothing", () => {
    const mostlyClean = [...Array.from({ length: 9 }, () => record("a")), record("a", { clockOutAt: null, signoutMissingAt: at(19, 20) })];
    const note = honestyNote(totalsOf(mostlyClean, TODAY, "09:15"))!;
    assert.equal(note.serious, false);
    assert.match(note.text, /^1 of 10 shifts has unknown hours \(1 with no sign-out\)\./);
    assert.equal(honestyNote(totalsOf([record("a")], TODAY, "09:15")), null);
  });

  it("a person whose only shift has no sign-out has unknown hours, not 0h", () => {
    const only = totalsOf([record("a", { clockOutAt: null, signoutMissingAt: at(19, 20) })], TODAY, "09:15");
    assert.equal(only.complete, 0);
    assert.equal(only.unknown, 1);
    assert.match(honestyNote(only)!.text, /^1 of 1 shift has unknown hours/);
  });
});

describe("the register: grouping, who entered, people with no record", () => {
  const register = buildRegister({
    records: messyWeek(),
    staff: [
      { id: "a", name: "Ada Okafor", department: "Legal" },
      { id: "b", name: "Bola Ade", department: "Finance" },
      { id: "c", name: "Chidi Eze", department: "Legal" },
      { id: "d", name: "Dayo Cole", department: null },
      { id: "e", name: "Efe Musa", department: "Finance" },
      { id: "f", name: "Funmi Bello", department: "HR" },
    ],
    leave: [{ staffId: "f", startsOn: "2026-10-15", endsOn: "2026-10-20", kind: "Annual" }],
    from: "2026-10-19",
    to: TODAY,
    today: TODAY,
    lateAfter: "09:15",
  });

  it("groups by department, A to Z, with people who have none in their own group last", () => {
    assert.deepEqual(
      register.groups.map((group) => group.label),
      ["Finance", "Legal", "No department"],
    );
    assert.deepEqual(
      register.groups[1]!.people.map((person) => person.name),
      ["Ada Okafor", "Chidi Eze"],
    );
  });

  it("each group and person carries its own totals, by the same rules", () => {
    const legal = register.groups[1]!;
    assert.equal(legal.totals.shifts, 3, "Ada's two and Chidi's live one; Chidi's removed one is not there");
    assert.equal(legal.totals.unknown, 1);
    assert.equal(legal.totals.inProgress, 1);
    const chidi = legal.people[1]!;
    assert.equal(chidi.records.length, 1);
    assert.equal(chidi.records[0]!.voidedAt, null);
  });

  it("who entered: arrivals and departures are counted SEPARATELY, and no-sign-out marks too", () => {
    const a = register.enteredBy.find((entry) => entry.name === "Desk A")!;
    const b = register.enteredBy.find((entry) => entry.name === "Desk B")!;
    assert.deepEqual(a, { name: "Desk A", arrivals: 6, departures: 2, noSignoutMarks: 0 });
    assert.deepEqual(b, { name: "Desk B", arrivals: 0, departures: 1, noSignoutMarks: 1 });
  });

  it("people with no record are listed apart; people on leave are not called missing", () => {
    assert.deepEqual(
      register.noRecord.map((person) => person.name),
      ["Efe Musa"],
    );
    assert.deepEqual(
      register.onLeaveOnly.map((person) => [person.name, person.leaveDays]),
      [["Funmi Bello", 2]],
      "the 19th and 20th of a leave that started on the 15th",
    );
  });

  it("the period's days are counted inclusively", () => {
    assert.equal(register.days, 8);
    assert.equal(daysIn(TODAY, TODAY), 1);
  });
});

describe("the late setting", () => {
  it("is read only when it is a real time of day; anything else is no rule, not a guess", () => {
    assert.equal(parseLateAfter("09:15"), "09:15");
    assert.equal(parseLateAfter("9:15"), null);
    assert.equal(parseLateAfter("25:00"), null);
    assert.equal(parseLateAfter(915), null);
    assert.equal(parseLateAfter(null), null);
    assert.equal(isLate(at(19, 9, 16), null), null);
  });
});

describe("the period shown", () => {
  it("nothing asked for is today; one day is that day; a later end is cut at today", () => {
    assert.deepEqual(parsePeriod(undefined, undefined, TODAY), { from: TODAY, to: TODAY, problem: null });
    assert.deepEqual(parsePeriod("2026-10-19", undefined, TODAY), { from: "2026-10-19", to: "2026-10-19", problem: null });
    assert.deepEqual(parsePeriod("2026-10-01", "2026-10-31", TODAY), { from: "2026-10-01", to: TODAY, problem: null });
  });

  it("backwards, unreadable, in the future or too long: today, and says why", () => {
    assert.match(parsePeriod("2026-10-20", "2026-10-19", TODAY).problem!, /first day is after the last/);
    assert.match(parsePeriod("2026-02-30", undefined, TODAY).problem!, /could not be read/);
    assert.match(parsePeriod("2026-11-02", undefined, TODAY).problem!, /future/);
    assert.match(parsePeriod("2026-01-01", TODAY, TODAY).problem!, /at most 92 days/);
  });
});
