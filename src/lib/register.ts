// SCREEN 08, THE ATTENDANCE REGISTER: the rules for what it shows, above all THE HOURS. Pure:
// it groups and counts what registerStore.ts read; it imports nothing from Next, `pg` or the
// browser. Nothing here is stored (CLAUDE.md, "NEVER STORED: derived values").
//
// It is the front desk's COPY of the paper book. It shows what was TYPED and WHO typed it, not
// proof that anyone was present.
//
// EVERY SHIFT IS ONE OF FOUR KINDS, and each is counted the same way everywhere (the period,
// a department, a person):
//   complete      a time in and a time out        its hours are KNOWN and are in the total
//   noSignout     marked never signed out (013)   hours UNKNOWN: never zero, never estimated
//   openEarlier   still open, from a Lagos day    hours UNKNOWN, exactly like a no-sign-out:
//                 before today (the forgotten     nobody recorded when they left, and running
//                 shift; the board shows it IN,   it up to now would invent a twenty-hour day.
//                 "open since")                   Counted as a shift that day (they arrived,
//                                                 and can be late), never as completed.
//   inProgress    still open, from TODAY          not finished: not in the total, shown with
//                                                 its time so far, and counted on its own
// THE TOTAL OF HOURS IS ONLY EVER THE COMPLETE SHIFTS, and it is never shown without the
// count of shifts it leaves out beside it. A total that silently omits unknown shifts is a lie
// that looks like a number; honestyNote() says how much of the period is unaccounted for.
//
// Hours are time in to time out. Movements (approved trips away during the day) are NOT
// deducted; the register says so.
//
// A REMOVED record (voided, 014) is not a shift: it is in no list and no count here (the store
// leaves it out, and so does every function below, in case one is ever handed one).
//
// LATE is by the setting attendance.late_after_local (a Lagos wall-clock time, "09:15"): a
// clock-in strictly after that time on its own Lagos day. A missing or unreadable setting is
// NOT replaced by a guess: lateness is then shown as unknown.
import { lagosAddDays, lagosDateOf, lagosInstantAt } from "./lagosTime.ts";

export interface RegisterRecord {
  id: string;
  staffId: string;
  name: string;
  department: string | null;
  clockInAt: Date;
  clockOutAt: Date | null;
  /** Marked never signed out (013): closed, with no time. */
  signoutMissingAt: Date | null;
  voidedAt: Date | null;
  /** WHO TYPED the arrival, and the departure: often two different front-desk people. */
  clockInByName: string | null;
  clockOutByName: string | null;
  /** Who marked it never signed out. */
  signoutMissingByName: string | null;
  /** Set when the record was entered on a later day than the one it describes (010). */
  backdateReason: string | null;
  /** The LATEST correction (014). The full history is in audit_log. */
  correctedAt: Date | null;
  correctedByName: string | null;
  correctionReason: string | null;
  /** The latest time it was RESTORED after a removal (from audit_log), if ever. */
  restoredAt: Date | null;
  restoredByName: string | null;
  restoredReason: string | null;
  /** Live (not removed) movements of this record, and how many of them the person approved themselves. */
  movements: number;
  selfApprovedMovements: number;
}

export interface RegisterStaff {
  id: string;
  name: string;
  department: string | null;
}

export interface RegisterLeave {
  staffId: string;
  /** YYYY-MM-DD, inclusive. */
  startsOn: string;
  endsOn: string;
  kind: string;
}

export type ShiftKind = "complete" | "noSignout" | "openEarlier" | "inProgress";

/** Which of the four kinds a (live) record is, on `today` (the Lagos date now). */
export function shiftKind(record: Pick<RegisterRecord, "clockInAt" | "clockOutAt" | "signoutMissingAt">, today: string): ShiftKind {
  if (record.signoutMissingAt !== null) return "noSignout";
  if (record.clockOutAt !== null) return "complete";
  return lagosDateOf(record.clockInAt) < today ? "openEarlier" : "inProgress";
}

/** The hours of a shift, in ms, ONLY when they are known (a complete shift). Never zero for an unknown. */
export function knownHoursMs(record: Pick<RegisterRecord, "clockInAt" | "clockOutAt" | "signoutMissingAt">): number | null {
  if (record.signoutMissingAt !== null || record.clockOutAt === null) return null;
  return record.clockOutAt.getTime() - record.clockInAt.getTime();
}

const LATE_AFTER = /^([01]\d|2[0-3]):[0-5]\d$/;

/** The setting's value ("09:15") if it is a readable time of day, else null (never a guess). */
export function parseLateAfter(value: unknown): string | null {
  return typeof value === "string" && LATE_AFTER.test(value) ? value : null;
}

/** Late: in strictly after the late-after time on the record's own Lagos day. Null when there is no rule. */
export function isLate(clockInAt: Date, lateAfter: string | null): boolean | null {
  if (lateAfter === null) return null;
  return clockInAt.getTime() > lagosInstantAt(lagosDateOf(clockInAt), lateAfter).getTime();
}

/** A record that needs a reader's eye: not a plain completed shift, or changed after the fact. */
export function isMarked(record: RegisterRecord, today: string): boolean {
  return (
    shiftKind(record, today) !== "complete" ||
    record.correctedAt !== null ||
    record.restoredAt !== null ||
    record.backdateReason !== null ||
    record.selfApprovedMovements > 0
  );
}

export interface Totals {
  /** Live records: every shift, whatever its kind. */
  shifts: number;
  /** Distinct people with at least one shift. */
  people: number;
  complete: number;
  /** The sum of the COMPLETE shifts only. */
  knownMs: number;
  noSignout: number;
  openEarlier: number;
  inProgress: number;
  /** Shifts whose hours are unknown: noSignout + openEarlier. Always shown beside knownMs. */
  unknown: number;
  /** Null when the late rule is not set. */
  late: number | null;
  corrected: number;
  restored: number;
  backdated: number;
  movements: number;
  selfApproved: number;
}

const live = (records: readonly RegisterRecord[]) => records.filter((record) => record.voidedAt === null);

export function totalsOf(records: readonly RegisterRecord[], today: string, lateAfter: string | null): Totals {
  const shown = live(records);
  const totals: Totals = {
    shifts: shown.length,
    people: new Set(shown.map((record) => record.staffId)).size,
    complete: 0,
    knownMs: 0,
    noSignout: 0,
    openEarlier: 0,
    inProgress: 0,
    unknown: 0,
    late: lateAfter === null ? null : 0,
    corrected: 0,
    restored: 0,
    backdated: 0,
    movements: 0,
    selfApproved: 0,
  };
  for (const record of shown) {
    totals[shiftKind(record, today)] += 1;
    const hours = knownHoursMs(record);
    if (hours !== null) totals.knownMs += hours;
    if (totals.late !== null && isLate(record.clockInAt, lateAfter)) totals.late += 1;
    if (record.correctedAt !== null) totals.corrected += 1;
    if (record.restoredAt !== null) totals.restored += 1;
    if (record.backdateReason !== null) totals.backdated += 1;
    totals.movements += record.movements;
    totals.selfApproved += record.selfApprovedMovements;
  }
  totals.unknown = totals.noSignout + totals.openEarlier;
  return totals;
}

/** The share of shifts with unknown hours at which the total is said to mean little. */
export const UNKNOWN_SHARE_WARNING = 0.2;

/**
 * What the total of hours does NOT cover, in words, or null when it covers everything. Never
 * leave this off a screen that shows a total: it is what stops the total being misread.
 */
export function honestyNote(totals: Totals): { serious: boolean; text: string } | null {
  if (totals.unknown === 0 && totals.inProgress === 0) return null;
  const parts: string[] = [];
  if (totals.unknown > 0) {
    const why = [
      totals.noSignout > 0 ? `${totals.noSignout} with no sign-out` : null,
      totals.openEarlier > 0 ? `${totals.openEarlier} never closed` : null,
    ]
      .filter(Boolean)
      .join(", ");
    parts.push(
      `${totals.unknown} of ${totals.shifts} ${totals.shifts === 1 ? "shift" : "shifts"} ${totals.unknown === 1 ? "has" : "have"} unknown hours (${why}). ` +
        `The total covers only the ${totals.complete} completed ${totals.complete === 1 ? "shift" : "shifts"}: it is a minimum, not the hours worked.`,
    );
  }
  if (totals.inProgress > 0) {
    parts.push(`${totals.inProgress} ${totals.inProgress === 1 ? "shift is" : "shifts are"} still in progress today and not in the total yet.`);
  }
  const serious = totals.shifts > 0 && totals.unknown / totals.shifts >= UNKNOWN_SHARE_WARNING;
  if (serious) parts.push("With this many unknown, the total says little about the period.");
  return { serious, text: parts.join(" ") };
}

export interface RegisterPerson {
  staffId: string;
  name: string;
  department: string | null;
  records: RegisterRecord[];
  totals: Totals;
  /** Days of leave inside the period. */
  leaveDays: number;
  leaveKinds: string[];
  /** Who typed this person's arrivals, most first: "Desk A (12)". */
  enteredBy: { name: string; count: number }[];
}

export interface RegisterGroup {
  department: string | null;
  label: string;
  people: RegisterPerson[];
  totals: Totals;
}

export interface EnteredBy {
  name: string;
  arrivals: number;
  departures: number;
  noSignoutMarks: number;
}

export interface Register {
  from: string;
  to: string;
  days: number;
  today: string;
  lateAfter: string | null;
  totals: Totals;
  groups: RegisterGroup[];
  /** Active people with NO record in the period and no leave in it: not in the book copy. */
  noRecord: RegisterStaff[];
  /** People with leave in the period and no record. */
  onLeaveOnly: RegisterPerson[];
  enteredBy: EnteredBy[];
}

export const NO_DEPARTMENT = "No department";

const byName = <T extends { name: string }>(a: T, b: T) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" });

/** Days from `from` to `to`, inclusive. */
export function daysIn(from: string, to: string): number {
  let days = 1;
  for (let day = from; day < to; day = lagosAddDays(day, 1)) days += 1;
  return days;
}

function leaveDaysIn(leave: readonly RegisterLeave[], from: string, to: string): number {
  const days = new Set<string>();
  for (const entry of leave) {
    const first = entry.startsOn > from ? entry.startsOn : from;
    const last = entry.endsOn < to ? entry.endsOn : to;
    for (let day = first; day <= last; day = lagosAddDays(day, 1)) days.add(day);
  }
  return days.size;
}

function tally(names: (string | null)[]): { name: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const name of names) if (name !== null) counts.set(name, (counts.get(name) ?? 0) + 1);
  return [...counts].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

export function buildRegister(input: {
  records: readonly RegisterRecord[];
  staff: readonly RegisterStaff[];
  leave: readonly RegisterLeave[];
  from: string;
  to: string;
  today: string;
  lateAfter: string | null;
}): Register {
  const { from, to, today, lateAfter } = input;
  const records = live(input.records).sort((a, b) => a.clockInAt.getTime() - b.clockInAt.getTime());
  const leaveOf = new Map<string, RegisterLeave[]>();
  for (const entry of input.leave) {
    if (entry.endsOn < from || entry.startsOn > to) continue;
    leaveOf.set(entry.staffId, [...(leaveOf.get(entry.staffId) ?? []), entry]);
  }

  const person = (staffId: string, name: string, department: string | null, mine: RegisterRecord[]): RegisterPerson => {
    const leave = leaveOf.get(staffId) ?? [];
    return {
      staffId,
      name,
      department,
      records: mine,
      totals: totalsOf(mine, today, lateAfter),
      leaveDays: leaveDaysIn(leave, from, to),
      leaveKinds: [...new Set(leave.map((entry) => entry.kind))],
      enteredBy: tally(mine.map((record) => record.clockInByName)),
    };
  };

  const recordsOf = new Map<string, RegisterRecord[]>();
  for (const record of records) recordsOf.set(record.staffId, [...(recordsOf.get(record.staffId) ?? []), record]);

  const groupsOf = new Map<string | null, RegisterPerson[]>();
  for (const [staffId, mine] of recordsOf) {
    const first = mine[0]!;
    groupsOf.set(first.department, [...(groupsOf.get(first.department) ?? []), person(staffId, first.name, first.department, mine)]);
  }
  const groups = [...groupsOf]
    .map(([department, people]): RegisterGroup => ({
      department,
      label: department ?? NO_DEPARTMENT,
      people: people.sort(byName),
      totals: totalsOf(
        people.flatMap((entry) => entry.records),
        today,
        lateAfter,
      ),
    }))
    // Departments A to Z; people with none in their own group, last.
    .sort((a, b) => (a.department === null ? 1 : b.department === null ? -1 : a.department.localeCompare(b.department)));

  const withoutRecord = input.staff.filter((member) => !recordsOf.has(member.id));
  const onLeaveOnly = withoutRecord
    .filter((member) => leaveOf.has(member.id))
    .map((member) => person(member.id, member.name, member.department, []))
    .sort(byName);
  const noRecord = withoutRecord.filter((member) => !leaveOf.has(member.id)).sort(byName);

  const arrivals = tally(records.map((record) => record.clockInByName));
  const departures = tally(records.map((record) => record.clockOutByName));
  const marks = tally(records.map((record) => record.signoutMissingByName));
  const names = [...new Set([...arrivals, ...departures, ...marks].map((entry) => entry.name))];
  const count = (list: { name: string; count: number }[], name: string) => list.find((entry) => entry.name === name)?.count ?? 0;
  const enteredBy = names
    .map((name) => ({ name, arrivals: count(arrivals, name), departures: count(departures, name), noSignoutMarks: count(marks, name) }))
    .sort((a, b) => b.arrivals + b.departures - (a.arrivals + a.departures) || a.name.localeCompare(b.name));

  return {
    from,
    to,
    days: daysIn(from, to),
    today,
    lateAfter,
    totals: totalsOf(records, today, lateAfter),
    groups,
    noRecord,
    onLeaveOnly,
    enteredBy,
  };
}

// ---- the period shown ---------------------------------------------------------------------

/** The longest period the register shows at once: about a quarter. */
export const MAX_PERIOD_DAYS = 92;

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function realDay(raw: string | undefined): string | null {
  if (raw === undefined || !DATE.test(raw)) return null;
  try {
    lagosAddDays(raw, 0); // throws on a date that does not exist (2026-02-30)
    return raw;
  } catch {
    return null;
  }
}

/**
 * The Lagos days to show, first to last inclusive, from ?from= and ?to=. Nothing asked for is
 * today. One day alone is that day. A day after today is today (nothing can be recorded for
 * it). A period backwards, or longer than MAX_PERIOD_DAYS, is not guessed at: today is shown,
 * with a message saying why.
 */
export function parsePeriod(rawFrom: string | undefined, rawTo: string | undefined, today: string): { from: string; to: string; problem: string | null } {
  let from = realDay(rawFrom);
  let to = realDay(rawTo);
  if ((rawFrom !== undefined && rawFrom !== "" && from === null) || (rawTo !== undefined && rawTo !== "" && to === null)) {
    return { from: today, to: today, problem: "That date could not be read. Showing today." };
  }
  if (from === null && to === null) return { from: today, to: today, problem: null };
  from ??= to!;
  to ??= from;
  if (from > today) return { from: today, to: today, problem: "That period is in the future. Showing today." };
  if (to > today) to = today;
  if (from > to) return { from: today, to: today, problem: "The first day is after the last day. Showing today." };
  if (daysIn(from, to) > MAX_PERIOD_DAYS) {
    return { from: today, to: today, problem: `Show at most ${MAX_PERIOD_DAYS} days at a time. Showing today.` };
  }
  return { from, to, problem: null };
}
