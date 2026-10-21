// CORRECTING an attendance record: the rules. The database is reached only through
// CorrectionStore (correctionStore.ts is the PostgreSQL one; the tests use an in-memory
// one); this file imports nothing from Next, `pg` or the browser.
//
// She will type 09:30 where the book says 08:30. A mistake that cannot be fixed makes
// her keep a second paper list, so five things can be fixed, from the board, for any day:
//   arrival     change the time in
//   departure   change the time out (or give a time to a shift marked never signed out)
//   reopen      undo a clock-out entered by mistake
//   unmark      undo a "never signed out" mark: back to still in
//   void        REMOVE a record entered for the wrong person
//   restore     UN-REMOVE a record that was removed by mistake
//
// THE RULES
//  * EVERY correction needs a REASON. No exception, no default text, no silent fix. The
//    reason is the control: it is NOT a permission gate. FRONT_DESK and ADMIN may both
//    correct (the person who typed the mistake is the person who notices it).
//  * Every correction records who and when (corrected_by, corrected_at, correction_reason:
//    the LATEST one, so a list can show at a glance that a record was changed) and writes
//    an audit_log row with the before and after (the full history).
//  * The person and the record are LOCKED (FOR UPDATE) first, and the caller sends back
//    the VERSION it was looking at. If the record has changed since (someone else got
//    there first), nothing is written and she is told so: never a database error, never
//    a silent second write.
//  * Reopening a shift (and unmarking) puts the record back to OPEN, and a person may
//    have only one open shift: if they already have one it is refused, naming it.
//  * A time lies on the record's own Lagos day, is not in the future, and keeps the shift
//    in order: time in before time out, and a movement lies inside its shift (the
//    database cannot check that across tables; see migration 010, so this does).
//  * REMOVED IS A VOID, NOT A DELETE (migration 014): the row stays, with its reason and
//    who removed it, and is left out of every list and count. A record with (live)
//    movements cannot be removed.
//  * A removal has a way back, the same shape as the others: RESTORE needs a reason, records
//    who and when, and is blocked if putting the record back would break the one-open-shift
//    rule or the one-record-a-day rule (naming what is in the way). Without it a mis-removal
//    gets "fixed" by entering a duplicate.
import { parseClockTime } from "./clockTime.ts";
import { timeLabel } from "./departureTime.ts";
import { formatIsoDate } from "./format.ts";
import { lagosDateOf, lagosDayRange, lagosInstantAt } from "./lagosTime.ts";

export const CORRECTION_KINDS = ["arrival", "departure", "reopen", "unmark", "void", "restore"] as const;
export type CorrectionKind = (typeof CORRECTION_KINDS)[number];

export const CORRECTION_LIMITS = Object.freeze({ maxReasonLength: 500 });

export interface CorrectionRecord {
  id: string;
  staffId: string;
  name: string;
  clockInAt: Date;
  clockOutAt: Date | null;
  signoutMissingAt: Date | null;
  voidedAt: Date | null;
  /** The record's updated_at, as text: changes with every change to the record. */
  version: string;
  movementCount: number;
  firstMovementAt: Date | null;
  /** The latest time any movement of this record left or returned. */
  lastMovementAt: Date | null;
  /** The start of ANOTHER live open shift of the same person, if they have one. */
  otherOpenSince: Date | null;
}

export type Correction =
  | { kind: "arrival"; clockInAt: Date }
  | { kind: "departure"; clockOutAt: Date }
  | { kind: "reopen" }
  | { kind: "unmark" }
  | { kind: "void" }
  | { kind: "restore" };

export interface CorrectionTx {
  /** Locks the person (staff row) and then the record, FOR UPDATE, in that order. */
  lock(recordId: string): Promise<void>;
  find(recordId: string): Promise<CorrectionRecord | null>;
  /** Does this person have ANOTHER live (not removed) record that starts inside this Lagos day? */
  hasOtherLiveRecordOnDay(recordId: string, day: { start: Date; end: Date }): Promise<boolean>;
  /** Guarded by the version AND by the state the rule just checked. False if nothing was updated. */
  apply(input: { id: string; version: string; actorId: string; reason: string; correction: Correction }): Promise<boolean>;
  audit(entry: { actorId: string; entityId: string; before: Record<string, unknown>; after: Record<string, unknown> }): Promise<void>;
}

export interface CorrectionStore {
  transaction<T>(work: (tx: CorrectionTx) => Promise<T>): Promise<T>;
}

export interface CorrectionDeps {
  store: CorrectionStore;
  actorId: string;
  now: Date;
}

export interface CorrectionInput {
  recordId: string;
  /** The version of the record the person was looking at. */
  version: string;
  kind: string;
  /** The new time, for arrival and departure. */
  time: string;
  reason: string;
}

export type CorrectionResult = { ok: true; message: string } | { ok: false; message: string };

export const NEEDS_REASON = "A correction needs a reason: say what was wrong, for example the book says 08:30.";
export const STALE_VERSION = "This record was changed by someone else while you were looking at it. Nothing was changed. Close this and open it again to see the latest.";

const fail = (message: string): CorrectionResult => ({ ok: false, message });
const iso = (date: Date | null) => (date === null ? null : date.toISOString());

export async function correctRecord(input: CorrectionInput, deps: CorrectionDeps): Promise<CorrectionResult> {
  // 1. The reason comes first, before anything is read: no correction without one.
  const reason = typeof input.reason === "string" ? input.reason.trim() : "";
  if (reason === "") return fail(NEEDS_REASON);
  if (reason.length > CORRECTION_LIMITS.maxReasonLength) return fail(`Keep the reason under ${CORRECTION_LIMITS.maxReasonLength} characters.`);

  const kind = CORRECTION_KINDS.find((candidate) => candidate === input.kind);
  if (kind === undefined) return fail("That kind of correction is not known. Reload the page and try again.");
  if (typeof input.recordId !== "string" || input.recordId === "" || typeof input.version !== "string" || input.version === "") {
    return fail(STALE_VERSION);
  }

  // 2. A time, for the two kinds that take one.
  let hhmm = "";
  if (kind === "arrival" || kind === "departure") {
    const parsed = parseClockTime(input.time);
    if (!parsed.ok) return fail(parsed.message);
    hhmm = parsed.hhmm;
  }

  return deps.store.transaction(async (tx): Promise<CorrectionResult> => {
    await tx.lock(input.recordId);
    const record = await tx.find(input.recordId);
    if (record === null) return fail(STALE_VERSION);
    // A removed record can only be restored; nothing else may touch it.
    if (kind === "restore") {
      if (record.voidedAt === null) return fail(`${record.name}'s record is not removed.`);
    } else if (record.voidedAt !== null) {
      return fail(`${record.name}'s record has been removed. Restore it first to change it.`);
    }
    // Someone else changed it since she opened it: say so, change nothing.
    if (record.version !== input.version) return fail(STALE_VERSION);

    const day = lagosDateOf(record.clockInAt);
    const inLabel = timeLabel(record.clockInAt);
    const isMarked = record.signoutMissingAt !== null;
    const isOpen = record.clockOutAt === null && !isMarked;
    let correction: Correction;
    let before: Record<string, unknown>;
    let after: Record<string, unknown>;
    let message: string;

    switch (kind) {
      case "arrival": {
        const at = lagosInstantAt(day, hhmm);
        if (at.getTime() === record.clockInAt.getTime()) return fail(`${record.name}'s time in is already ${inLabel}.`);
        if (at.getTime() > deps.now.getTime()) return fail("That time has not happened yet.");
        if (record.clockOutAt !== null && at.getTime() >= record.clockOutAt.getTime()) {
          return fail(`Time in must be before their time out, ${timeLabel(record.clockOutAt)}.`);
        }
        if (record.firstMovementAt !== null && at.getTime() > record.firstMovementAt.getTime()) {
          return fail(`${record.name} has a movement recorded from ${timeLabel(record.firstMovementAt)}, before that time.`);
        }
        correction = { kind, clockInAt: at };
        before = { clock_in_at: iso(record.clockInAt) };
        after = { clock_in_at: at.toISOString() };
        message = `${record.name}: time in changed from ${inLabel} to ${hhmm}.`;
        break;
      }
      case "departure": {
        if (isOpen) return fail(`${record.name} has not been clocked out. Use Clock out.`);
        const at = lagosInstantAt(day, hhmm);
        if (record.clockOutAt !== null && at.getTime() === record.clockOutAt.getTime()) {
          return fail(`${record.name}'s time out is already ${timeLabel(record.clockOutAt)}.`);
        }
        if (at.getTime() <= record.clockInAt.getTime()) return fail(`Time out must be after their time in, ${inLabel}.`);
        if (at.getTime() > deps.now.getTime()) return fail("That time has not happened yet.");
        if (record.lastMovementAt !== null && record.lastMovementAt.getTime() > at.getTime()) {
          return fail(`${record.name} has a movement recorded until ${timeLabel(record.lastMovementAt)}, after that time.`);
        }
        correction = { kind, clockOutAt: at };
        before = { clock_out_at: iso(record.clockOutAt), signout_missing_at: iso(record.signoutMissingAt) };
        after = { clock_out_at: at.toISOString(), signout_missing_at: null };
        message =
          record.clockOutAt === null
            ? `${record.name}: time out set to ${hhmm} (it was marked never signed out).`
            : `${record.name}: time out changed from ${timeLabel(record.clockOutAt)} to ${hhmm}.`;
        break;
      }
      case "reopen": {
        if (record.clockOutAt === null) return fail(`${record.name} has no clock-out to undo.`);
        if (record.otherOpenSince !== null) return fail(otherOpen(record.name, record.otherOpenSince));
        correction = { kind };
        before = { clock_out_at: iso(record.clockOutAt) };
        after = { clock_out_at: null };
        message = `${record.name} is back in: the clock-out was undone.`;
        break;
      }
      case "unmark": {
        if (!isMarked) return fail(`${record.name} is not marked as never signed out.`);
        if (record.otherOpenSince !== null) return fail(otherOpen(record.name, record.otherOpenSince));
        correction = { kind };
        before = { signout_missing_at: iso(record.signoutMissingAt) };
        after = { signout_missing_at: null };
        message = `${record.name} is back to still in: the never-signed-out mark was removed.`;
        break;
      }
      case "restore": {
        // Putting it back must not break the rules the removal was hiding from.
        const dayRange = lagosDayRange(day);
        if (await tx.hasOtherLiveRecordOnDay(record.id, dayRange)) {
          return fail(`${record.name} already has a record for ${formatIsoDate(day)}, so this one cannot be restored.`);
        }
        if (isOpen && record.otherOpenSince !== null) return fail(otherOpen(record.name, record.otherOpenSince));
        correction = { kind };
        before = { voided: true };
        after = { voided: false };
        message = `${record.name}'s record was restored.`;
        break;
      }
      case "void": {
        if (record.movementCount > 0) {
          return fail(`${record.name} has movements recorded against this record, so it cannot be removed. Correct it instead.`);
        }
        correction = { kind };
        before = { voided: false };
        after = { voided: true };
        message = `${record.name}'s record was removed.`;
        break;
      }
    }

    const applied = await tx.apply({ id: record.id, version: input.version, actorId: deps.actorId, reason, correction });
    if (!applied) return fail(STALE_VERSION);
    await tx.audit({
      actorId: deps.actorId,
      entityId: record.id,
      before,
      after: { ...after, correction: kind, correction_reason: reason, via: "correction" },
    });
    return { ok: true, message };
  });
}

function otherOpen(name: string, since: Date): string {
  return `${name} is already recorded as in since ${formatIsoDate(lagosDateOf(since))}, and a person can have only one open shift. Clock that one out first.`;
}
