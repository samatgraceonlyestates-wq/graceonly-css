// Saving a batch of arrivals copied from the paper attendance book. The rules live
// here; the database is reached only through the ArrivalStore interface
// (arrivalStore.ts is the PostgreSQL one, the tests use an in-memory one), and this
// file imports nothing from Next, `pg` or the browser.
//
// THE SHAPE OF A SAVE. One transaction. Inside it, in this order and with NO write
// before the last check has passed:
//   1. load the roster; resolve every row's name to a person (an existing one, or a
//      new roster entry to be created);
//   2. lock the existing people involved, then look at their existing records;
//   3. collect EVERY problem across EVERY row, and every name that needs the front
//      desk's confirmation;
//   4. if there is any problem or any confirmation: return it and write NOTHING.
//      Otherwise create the new roster people, the records and their audit rows.
// So a batch is saved whole or not at all: a half-saved page she cannot see the
// shape of is worse than a rejected one. (If the database itself fails part-way,
// the transaction rolls back and the caller is given the fixed message.)
//
// RULES THAT ARE THE APPLICATION'S, NOT THE DATABASE'S (each is commented where it
// is applied):
//  * One record per person per LAGOS DAY. The database only forbids a second OPEN
//    shift for a person (attendance_one_open_shift_key); "a record for that day" is
//    a question about a date range in Lagos, which no constraint here can express.
//    The people involved are locked (SELECT ... FOR UPDATE, in id order, so two
//    front-desk users saving at once cannot both pass the check) before it is made.
//  * A record created for an EARLIER Lagos day carries a reason (backdate_reason).
//    The database cannot require it: now() cannot appear in a CHECK.
//  * A time in the future is refused. A future DAY is refused.
//
// BACK-DATING MEANS AN EARLIER LAGOS DAY, NOT A LATE ENTRY. Typing this morning's
// arrivals at 10:30 is ordinary work and never asks for a reason: the test is the
// Lagos DATE of the batch against today's Lagos date, never how late it is.
import { parseClockTime } from "./clockTime.ts";
import { formatIsoDate } from "./format.ts";
import { lagosDateOf, lagosDayRange, lagosInstantAt } from "./lagosTime.ts";
import { cleanDisplayName, matchName, normaliseName, type RosterName } from "./rosterMatch.ts";

/** Who may enter attendance: the front desk, and the owner as admin (a Super Admin passes as ADMIN). */
export const ARRIVAL_ROLES = ["FRONT_DESK", "ADMIN"] as const;

export const BATCH_LIMITS = Object.freeze({ maxRows: 100, maxNameLength: 100, maxReasonLength: 500 });

// ---------------------------------------------------------------------------
// What comes in and what goes back

export interface ArrivalRowInput {
  /** The name as typed (or as filled in from a suggestion). */
  name: string;
  /** Set when she picked a suggestion; honoured only while the name still matches that person. */
  personId: string | null;
  timeIn: string;
  /** Only for an earlier day. */
  timeOut: string;
  /** She has said this name is a DIFFERENT person from the close ones shown. */
  confirmNew: boolean;
}

export interface ArrivalBatchInput {
  /** The Lagos day, YYYY-MM-DD. */
  date: string;
  /** Why the arrivals are being entered after their day. Used only for an earlier day. */
  reason: string;
  rows: ArrivalRowInput[];
}

export interface RowProblem {
  /** Index into the submitted rows (0-based). */
  row: number;
  field: "name" | "timeIn" | "timeOut" | "row";
  message: string;
}

export interface NameConfirmation {
  row: number;
  typed: string;
  candidates: RosterName[];
}

export type BatchResult =
  | { ok: true; saved: number; newPeople: number; date: string }
  | { ok: false; formProblem: string | null; problems: RowProblem[]; confirmations: NameConfirmation[] };

// ---------------------------------------------------------------------------
// What the rules need from the database

export interface ExistingShift {
  staffId: string;
  clockInAt: Date;
  clockOutAt: Date | null;
}

export interface NewAttendanceRecord {
  id: string;
  staffId: string;
  clockInAt: Date;
  /** Null for today's arrivals: the clock-out is entered later, one person at a time. */
  clockOutAt: Date | null;
  clockInEnteredBy: string;
  clockOutEnteredBy: string | null;
  backdateReason: string | null;
}

export interface ArrivalTx {
  /** Everyone who is active, roster people and login accounts alike. */
  loadRoster(): Promise<RosterName[]>;
  /** SELECT ... FOR UPDATE on these staff rows, in id order. */
  lockPeople(ids: readonly string[]): Promise<void>;
  /** These people's records that start inside the day, plus any shift of theirs still open. */
  shiftsFor(ids: readonly string[], day: { start: Date; end: Date }): Promise<ExistingShift[]>;
  createPerson(input: { id: string; name: string; actorId: string }): Promise<void>;
  createRecord(record: NewAttendanceRecord): Promise<void>;
  audit(entry: { actorId: string; entity: string; entityId: string; after: Record<string, unknown> }): Promise<void>;
}

export interface ArrivalStore {
  transaction<T>(work: (tx: ArrivalTx) => Promise<T>): Promise<T>;
}

export interface ArrivalDeps {
  store: ArrivalStore;
  /** The signed-in front-desk user: becomes clock_in_entered_by (and clock_out_entered_by). */
  actorId: string;
  now: Date;
  newId: () => string;
}

// ---------------------------------------------------------------------------
// Reading the untrusted payload

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The form posts its rows as JSON. Anything that is not exactly the expected shape is rejected, not repaired. */
export function parseBatchPayload(raw: unknown): ArrivalBatchInput | null {
  if (typeof raw !== "string" || raw.length > 200_000) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(parsed) || typeof parsed.date !== "string" || typeof parsed.reason !== "string" || !Array.isArray(parsed.rows)) return null;
  if (parsed.rows.length > BATCH_LIMITS.maxRows) return null;
  const rows: ArrivalRowInput[] = [];
  for (const item of parsed.rows) {
    if (!isRecord(item)) return null;
    const { name, personId, timeIn, timeOut, confirmNew } = item;
    if (typeof name !== "string" || typeof timeIn !== "string" || typeof timeOut !== "string") return null;
    if (personId !== null && typeof personId !== "string") return null;
    if (typeof confirmNew !== "boolean") return null;
    if (name.length > 1000 || timeIn.length > 50 || timeOut.length > 50) return null;
    rows.push({ name, personId, timeIn, timeOut, confirmNew });
  }
  return { date: parsed.date, reason: parsed.reason, rows };
}

// ---------------------------------------------------------------------------
// The rules

const DATE_SHAPE = /^\d{4}-\d{2}-\d{2}$/;

function isBlankRow(row: ArrivalRowInput): boolean {
  return row.name.trim() === "" && row.timeIn.trim() === "" && row.timeOut.trim() === "";
}

function fail(formProblem: string | null, problems: RowProblem[] = [], confirmations: NameConfirmation[] = []): BatchResult {
  return { ok: false, formProblem, problems, confirmations };
}

interface ResolvedPerson {
  id: string;
  name: string;
  isNew: boolean;
}

export async function saveArrivalBatch(input: ArrivalBatchInput, deps: ArrivalDeps): Promise<BatchResult> {
  const { store, actorId, now, newId } = deps;

  // --- The day -------------------------------------------------------------
  if (!DATE_SHAPE.test(input.date)) return fail("Choose the day.");
  let day;
  try {
    day = lagosDayRange(input.date);
  } catch {
    return fail("Choose a real date.");
  }
  const today = lagosDateOf(now);
  if (input.date > today) return fail("A day that has not happened yet cannot be entered.");
  const isEarlierDay = input.date < today;
  const dayLabel = formatIsoDate(input.date);

  // An earlier LAGOS day needs a reason, stored on every record in the batch. Today
  // never does, however late in the day it is.
  const reason = input.reason.trim();
  if (isEarlierDay && reason === "") return fail("Say why these are being entered after their day, for example: copied from the book the next morning.");
  if (reason.length > BATCH_LIMITS.maxReasonLength) return fail(`Keep the reason under ${BATCH_LIMITS.maxReasonLength} characters.`);

  // --- The rows ------------------------------------------------------------
  if (input.rows.length > BATCH_LIMITS.maxRows) return fail(`A page holds at most ${BATCH_LIMITS.maxRows} rows. Save this page and start another.`);
  const filled = input.rows.map((row, index) => ({ row, index })).filter(({ row }) => !isBlankRow(row));
  if (filled.length === 0) return fail("Enter at least one arrival.");

  const problems: RowProblem[] = [];
  const times = new Map<number, { inAt: Date; outAt: Date | null }>();
  for (const { row, index } of filled) {
    const parsedIn = parseClockTime(row.timeIn);
    if (!parsedIn.ok) problems.push({ row: index, field: "timeIn", message: parsedIn.message });
    let outAt: Date | null = null;
    if (isEarlierDay) {
      // An earlier day is reconstructed whole, so it takes a time out. It has to: a
      // record with no clock-out is an OPEN shift, and a person may have only one.
      const parsedOut = parseClockTime(row.timeOut);
      if (!parsedOut.ok) problems.push({ row: index, field: "timeOut", message: parsedOut.message });
      else outAt = lagosInstantAt(input.date, parsedOut.hhmm);
    } else if (row.timeOut.trim() !== "") {
      problems.push({ row: index, field: "timeOut", message: "Time out is only taken for an earlier day. Clock people out from the register." });
    }
    if (parsedIn.ok) {
      const inAt = lagosInstantAt(input.date, parsedIn.hhmm);
      if (!isEarlierDay && inAt.getTime() > now.getTime()) problems.push({ row: index, field: "timeIn", message: "That time has not happened yet today." });
      else if (isEarlierDay && outAt !== null && outAt.getTime() <= inAt.getTime()) problems.push({ row: index, field: "timeOut", message: "Time out must be after time in." });
      times.set(index, { inAt, outAt });
    }
  }

  // --- Everything else happens inside ONE transaction ----------------------
  return store.transaction(async (tx): Promise<BatchResult> => {
    const roster = await tx.loadRoster();
    const pool: RosterName[] = [...roster];
    const created: { id: string; name: string }[] = [];
    const confirmations: NameConfirmation[] = [];
    const resolved = new Map<number, ResolvedPerson>();
    const firstRowOf = new Map<string, number>();

    for (const { row, index } of filled) {
      const typed = cleanDisplayName(row.name);
      if (typed === "") {
        problems.push({ row: index, field: "name", message: "Enter a name." });
        continue;
      }
      if (typed.length > BATCH_LIMITS.maxNameLength) {
        problems.push({ row: index, field: "name", message: `Keep the name under ${BATCH_LIMITS.maxNameLength} characters.` });
        continue;
      }

      let person: ResolvedPerson | null = null;
      // A picked suggestion counts only while the name still IS that person's name.
      const picked = row.personId === null ? undefined : pool.find((candidate) => candidate.id === row.personId);
      if (picked !== undefined && normaliseName(picked.name) === normaliseName(typed)) {
        person = { id: picked.id, name: picked.name, isNew: created.some((c) => c.id === picked.id) };
      } else {
        const match = matchName(typed, pool);
        if (match.kind === "exact") {
          if (match.people.length > 1) {
            problems.push({ row: index, field: "name", message: `More than one person is called ${typed}. Pick the right one from the list.` });
            continue;
          }
          const only = match.people[0]!;
          person = { id: only.id, name: only.name, isNew: created.some((c) => c.id === only.id) };
        } else if (match.kind === "close" && !row.confirmNew) {
          confirmations.push({ row: index, typed, candidates: match.candidates.slice(0, 3) });
          continue;
        } else {
          // A name nobody has, or one she has confirmed is a different person: a new
          // roster entry. It joins the pool at once, so a second row typing the same
          // name (or one close to it) in this batch is held to the same rules.
          const id = newId();
          created.push({ id, name: typed });
          pool.push({ id, name: typed, department: null });
          person = { id, name: typed, isNew: true };
        }
      }

      const earlier = firstRowOf.get(person.id);
      if (earlier !== undefined) {
        problems.push({ row: index, field: "name", message: `${person.name} is already on row ${earlier + 1}. Each person appears once.` });
        continue;
      }
      firstRowOf.set(person.id, index);
      resolved.set(index, person);
    }

    // The existing people involved: lock them, then check their records. A new
    // person has none, so there is nothing to check for them.
    const existingIds = [...new Set([...resolved.values()].filter((p) => !p.isNew).map((p) => p.id))].sort();
    if (existingIds.length > 0) {
      await tx.lockPeople(existingIds);
      const shifts = await tx.shiftsFor(existingIds, day);
      for (const [index, person] of resolved) {
        if (person.isNew) continue;
        const mine = shifts.filter((shift) => shift.staffId === person.id);
        const onThisDay = mine.some((shift) => shift.clockInAt.getTime() >= day.start.getTime() && shift.clockInAt.getTime() < day.end.getTime());
        if (onThisDay) {
          problems.push({ row: index, field: "name", message: `${person.name} already has a record for ${dayLabel}.` });
          continue;
        }
        // Today's arrival is an OPEN shift, and a person may have only one open
        // shift at a time. (An earlier day's record is closed, so this cannot clash.)
        const stillOpen = isEarlierDay ? undefined : mine.find((shift) => shift.clockOutAt === null);
        if (stillOpen !== undefined) {
          problems.push({
            row: index,
            field: "name",
            message: `${person.name} is still recorded as in since ${formatIsoDate(lagosDateOf(stillOpen.clockInAt))}. Clock them out first.`,
          });
        }
      }
    }

    // --- The decision: nothing has been written yet --------------------------
    if (problems.length > 0 || confirmations.length > 0) {
      problems.sort((a, b) => a.row - b.row);
      confirmations.sort((a, b) => a.row - b.row);
      return fail(null, problems, confirmations);
    }

    // --- Write. The new roster people first, so the records can point at them. --
    for (const person of created) {
      await tx.createPerson({ id: person.id, name: person.name, actorId });
      // Ids and facts only: never the name, which is data about a person.
      await tx.audit({ actorId, entity: "staff", entityId: person.id, after: { roster: true, via: "arrival entry" } });
    }
    for (const { index } of filled) {
      const person = resolved.get(index)!;
      const at = times.get(index)!;
      const record: NewAttendanceRecord = {
        id: newId(),
        staffId: person.id,
        clockInAt: at.inAt,
        clockOutAt: at.outAt,
        clockInEnteredBy: actorId,
        clockOutEnteredBy: at.outAt === null ? null : actorId,
        backdateReason: isEarlierDay ? reason : null,
      };
      await tx.createRecord(record);
      await tx.audit({
        actorId,
        entity: "attendance_record",
        entityId: record.id,
        after: {
          staff_id: person.id,
          clock_in_at: record.clockInAt.toISOString(),
          clock_out_at: record.clockOutAt === null ? null : record.clockOutAt.toISOString(),
          backdate_reason: record.backdateReason,
          via: "arrival entry",
        },
      });
    }
    return { ok: true, saved: filled.length, newPeople: created.length, date: input.date };
  });
}
