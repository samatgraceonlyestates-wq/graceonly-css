// Ending a shift: clocking one person out as they leave, and marking people who went
// home without signing out. The rules live here; the database is reached only through
// DepartureStore (departureStore.ts is the PostgreSQL one, the tests use an in-memory
// one). Imports nothing from Next, `pg` or the browser.
//
// CLOCKING OUT. From a person who is IN she records their time out. The time is a time
// of day on the record's OWN Lagos day (today's for today's arrival; for a shift left
// open from an earlier day, that earlier day). It defaults to now on the screen but is
// editable, because she may type it minutes after they left. Refused: a time that is
// not after their time in; a time in the future; a person out on an open movement
// (their return comes first); a time before a movement of theirs ended (a movement
// lies inside its shift; the database cannot check that across tables, so this does,
// see the comment in migration 010). It records clock_out_entered_by (the signed-in
// user), so the arrival and the departure can have been typed by different people.
//
// MARKING NEVER SIGNED OUT (013). An EXPLICIT act, never something the app does by
// itself: she chooses the people. The shift is CLOSED with no time, and its hours are
// UNKNOWN: they are not zero and are never guessed. Refused for anyone who is not
// open, and for anyone out on an open movement (record their return first).
//
// Both are written in one transaction, lock the record first (FOR UPDATE), and write
// one audit row each. A write guarded by "still open" that finds nothing to update
// means someone else changed the record a moment ago, and says so.
import { parseClockTime } from "./clockTime.ts";
import { timeLabel } from "./departureTime.ts";
import { lagosDateOf, lagosInstantAt } from "./lagosTime.ts";

export const DEPARTURE_LIMITS = Object.freeze({ maxMarkAtOnce: 200 });

export interface DepartureRecord {
  id: string;
  staffId: string;
  name: string;
  clockInAt: Date;
  clockOutAt: Date | null;
  signoutMissingAt: Date | null;
  /** Removed (014): entered for the wrong person. It is not a shift. */
  voidedAt: Date | null;
  /** Who typed the clock-out, and who marked it never signed out: so a stale action can say who got there first. */
  clockOutByName: string | null;
  signoutMissingByName: string | null;
  hasOpenMovement: boolean;
  /** The latest time any movement of this record left or returned, or null if it has none. */
  lastMovementAt: Date | null;
}

export interface DepartureTx {
  lockRecords(ids: readonly string[]): Promise<void>;
  recordsByIds(ids: readonly string[]): Promise<DepartureRecord[]>;
  /** Guarded: only if still open. False if nothing was updated. */
  clockOut(input: { id: string; clockOutAt: Date; actorId: string }): Promise<boolean>;
  /** Guarded: only if still open. Returns the time the database marked it, or null if nothing was updated. */
  markNoSignout(input: { id: string; actorId: string }): Promise<Date | null>;
  audit(entry: { actorId: string; entityId: string; before: Record<string, unknown>; after: Record<string, unknown> }): Promise<void>;
}

export interface DepartureStore {
  transaction<T>(work: (tx: DepartureTx) => Promise<T>): Promise<T>;
}

export interface DepartureDeps {
  store: DepartureStore;
  actorId: string;
  now: Date;
}

const isOpen = (record: DepartureRecord) => record.clockOutAt === null && record.signoutMissingAt === null && record.voidedAt === null;

const STALE = "That record has changed. Reload the page and look again.";

export type ClockOutResult = { ok: true; name: string; time: string } | { ok: false; message: string };

export async function clockOutPerson(input: { recordId: string; timeOut: string }, deps: DepartureDeps): Promise<ClockOutResult> {
  const parsed = parseClockTime(input.timeOut);
  if (!parsed.ok) return { ok: false, message: parsed.message };
  if (typeof input.recordId !== "string" || input.recordId === "") return { ok: false, message: STALE };

  return deps.store.transaction(async (tx): Promise<ClockOutResult> => {
    await tx.lockRecords([input.recordId]);
    const [record] = await tx.recordsByIds([input.recordId]);
    if (record === undefined) return { ok: false, message: STALE };

    // A stale click (someone else got there first) is a clear message, never an error and
    // never a second write: the record is locked, and these checks run under the lock.
    if (record.voidedAt !== null) return { ok: false, message: `${record.name}'s record has been removed.` };
    if (record.signoutMissingAt !== null) {
      const by = record.signoutMissingByName ? ` by ${record.signoutMissingByName}` : "";
      return { ok: false, message: `${record.name} was marked as never signed out${by}, so their record is closed.` };
    }
    if (record.clockOutAt !== null) {
      const by = record.clockOutByName ? ` by ${record.clockOutByName}` : "";
      return { ok: false, message: `${record.name} was already clocked out at ${timeLabel(record.clockOutAt)}${by}.` };
    }

    // A time of day on the record's own Lagos day.
    const outAt = lagosInstantAt(lagosDateOf(record.clockInAt), parsed.hhmm);
    if (outAt.getTime() <= record.clockInAt.getTime()) {
      return { ok: false, message: `Time out must be after their time in, ${timeLabel(record.clockInAt)}.` };
    }
    if (outAt.getTime() > deps.now.getTime()) return { ok: false, message: "That time has not happened yet." };
    if (record.hasOpenMovement) return { ok: false, message: `${record.name} is recorded as out on a movement. Record their return first.` };
    if (record.lastMovementAt !== null && record.lastMovementAt.getTime() > outAt.getTime()) {
      return { ok: false, message: `${record.name} has a movement recorded until ${timeLabel(record.lastMovementAt)}, after that time.` };
    }

    const written = await tx.clockOut({ id: record.id, clockOutAt: outAt, actorId: deps.actorId });
    if (!written) return { ok: false, message: STALE };
    await tx.audit({
      actorId: deps.actorId,
      entityId: record.id,
      before: { clock_out_at: null, signout_missing_at: null },
      after: { clock_out_at: outAt.toISOString(), via: "departure" },
    });
    return { ok: true, name: record.name, time: parsed.hhmm };
  });
}

export interface SkippedPerson {
  name: string;
  reason: string;
}

export type MarkResult =
  | { ok: true; marked: number; skipped: SkippedPerson[] }
  | { ok: false; message: string };

export async function markNoSignout(input: { recordIds: readonly string[] }, deps: DepartureDeps): Promise<MarkResult> {
  const ids = [...new Set(input.recordIds.filter((id) => typeof id === "string" && id !== ""))].sort();
  if (ids.length === 0) return { ok: false, message: "Choose at least one person." };
  if (ids.length > DEPARTURE_LIMITS.maxMarkAtOnce) return { ok: false, message: `Mark at most ${DEPARTURE_LIMITS.maxMarkAtOnce} people at once.` };

  return deps.store.transaction(async (tx): Promise<MarkResult> => {
    await tx.lockRecords(ids);
    const records = await tx.recordsByIds(ids);
    let marked = 0;
    const skipped: SkippedPerson[] = [];

    for (const record of records) {
      if (!isOpen(record)) {
        skipped.push({
          name: record.name,
          reason: record.voidedAt !== null ? "removed" : record.signoutMissingAt !== null ? "already marked as never signed out" : "already clocked out",
        });
        continue;
      }
      if (record.hasOpenMovement) {
        skipped.push({ name: record.name, reason: "out on a movement: record their return first" });
        continue;
      }
      const at = await tx.markNoSignout({ id: record.id, actorId: deps.actorId });
      if (at === null) {
        skipped.push({ name: record.name, reason: "changed a moment ago" });
        continue;
      }
      await tx.audit({
        actorId: deps.actorId,
        entityId: record.id,
        before: { clock_out_at: null, signout_missing_at: null },
        after: { signout_missing_at: at.toISOString(), via: "end of day" },
      });
      marked += 1;
    }
    if (records.length < ids.length) skipped.push({ name: "Someone", reason: "could not be found" });
    return { ok: true, marked, skipped };
  });
}
