// THE MOVEMENT BOOK: a staff member leaves the premises during the day and comes back.
// She copies the second paper book into CSS exactly as she copies arrivals. The rules live
// here; the database is reached only through MovementTx (movementStore.ts is the PostgreSQL
// one; the tests use an in-memory one). Imports nothing from Next, `pg` or the browser.
//
// A DEPARTURE is recorded from a person who is IN: where they are going, what for, who
// approved it, and the time they left. The approver is a ROSTER PERSON, resolved by the SAME
// name rules as the arrivals sheet (nameResolution.ts: exact, close, new): a close name is a
// question, never silently accepted, and a name nobody has creates a roster person. The
// time defaults to now on the screen but is editable, with the clock-out rules.
//
// A RETURN is recorded from a person who is OUT: the time they came back (default now,
// editable), recorded as returned_entered_by, which may be a different person from whoever
// recorded the departure.
//
// THE RULES (the database cannot hold them across tables; see migration 010):
//  * a movement sits INSIDE its shift: after the time in, and (once clocked out) before the
//    time out. A person is clocked out only when they are back; the board says why.
//  * a return is after its departure; neither is in the future; movements of one record do
//    not overlap, and a person is out at most once at a time (the database's open-movement
//    index is the backstop).
//  * an approver cannot be the person leaving.
//  * a REMOVED (voided) movement counts for nothing: not out, not in any check here.
// The person and the record are locked FOR UPDATE first, and every check runs under the lock.
import { parseClockTime } from "./clockTime.ts";
import { timeLabel } from "./departureTime.ts";
import { lagosDateOf, lagosInstantAt } from "./lagosTime.ts";
import { resolveName, type NameInput } from "./nameResolution.ts";
import { cleanDisplayName, type RosterName } from "./rosterMatch.ts";

export const MOVEMENT_LIMITS = Object.freeze({ maxDestination: 100, maxPurpose: 200 });

export interface LiveMovement {
  id: string;
  leftAt: Date;
  returnedAt: Date | null;
}

/** The attendance record a departure is recorded against, with its live movements. */
export interface MovementShift {
  id: string;
  staffId: string;
  name: string;
  clockInAt: Date;
  clockOutAt: Date | null;
  signoutMissingAt: Date | null;
  voidedAt: Date | null;
  liveMovements: LiveMovement[];
}

export interface ExistingMovement {
  id: string;
  recordId: string;
  staffId: string;
  name: string;
  leftAt: Date;
  returnedAt: Date | null;
  returnedByName: string | null;
  voidedAt: Date | null;
  recordClockOutAt: Date | null;
  recordVoidedAt: Date | null;
}

export interface NewMovement {
  id: string;
  recordId: string;
  leftAt: Date;
  destination: string;
  purpose: string;
  approvedBy: string;
  leftEnteredBy: string;
}

export interface MovementAudit {
  actorId: string;
  entity: "movement" | "staff";
  entityId: string;
  action: "CREATE" | "UPDATE";
  before?: Record<string, unknown>;
  after: Record<string, unknown>;
}

export interface MovementTx {
  /** Locks the person, then the attendance record, FOR UPDATE. */
  lockRecord(recordId: string): Promise<void>;
  /** Locks the person, the attendance record and the movement, FOR UPDATE. */
  lockMovement(movementId: string): Promise<void>;
  loadRoster(): Promise<RosterName[]>;
  shift(recordId: string): Promise<MovementShift | null>;
  movement(movementId: string): Promise<ExistingMovement | null>;
  createPerson(input: { id: string; name: string; actorId: string }): Promise<void>;
  createMovement(movement: NewMovement): Promise<void>;
  /** Guarded: only a live movement that has not returned. False if nothing was updated. */
  returnMovement(input: { id: string; returnedAt: Date; actorId: string }): Promise<boolean>;
  audit(entry: MovementAudit): Promise<void>;
}

export interface MovementStore {
  transaction<T>(work: (tx: MovementTx) => Promise<T>): Promise<T>;
}

export interface MovementDeps {
  store: MovementStore;
  actorId: string;
  now: Date;
  newId: () => string;
}

export type MovementResult = { ok: true; message: string } | { ok: false; message: string };

const fail = (message: string): MovementResult => ({ ok: false, message });
export const MOVEMENT_STALE = "That record has changed. Reload the page and look again.";

/** Free text she types (a destination, a purpose): spacing tidied, case kept as typed. */
export function cleanPhrase(raw: unknown): string {
  return typeof raw === "string" ? cleanDisplayName(raw) : "";
}

/** The overlap rule: two intervals [leftA, returnedA) and [leftB, returnedB) (null = still out) overlap. */
export function overlaps(a: { leftAt: Date; returnedAt: Date | null }, b: { leftAt: Date; returnedAt: Date | null }): boolean {
  const aEnd = a.returnedAt === null ? Infinity : a.returnedAt.getTime();
  const bEnd = b.returnedAt === null ? Infinity : b.returnedAt.getTime();
  return a.leftAt.getTime() < bEnd && b.leftAt.getTime() < aEnd;
}

export interface DepartureInput {
  recordId: string;
  destination: string;
  purpose: string;
  /** The time left, 8:15, 08:15 or 0815. */
  timeLeft: string;
  approver: NameInput;
}

export async function recordDeparture(input: DepartureInput, deps: MovementDeps): Promise<MovementResult> {
  const destination = cleanPhrase(input.destination);
  const purpose = cleanPhrase(input.purpose);
  if (destination === "") return fail("Say where they are going.");
  if (destination.length > MOVEMENT_LIMITS.maxDestination) return fail(`Keep the destination under ${MOVEMENT_LIMITS.maxDestination} characters.`);
  if (purpose === "") return fail("Say what it is for.");
  if (purpose.length > MOVEMENT_LIMITS.maxPurpose) return fail(`Keep the purpose under ${MOVEMENT_LIMITS.maxPurpose} characters.`);
  const parsed = parseClockTime(input.timeLeft);
  if (!parsed.ok) return fail(parsed.message);
  if (typeof input.recordId !== "string" || input.recordId === "") return fail(MOVEMENT_STALE);

  return deps.store.transaction(async (tx): Promise<MovementResult> => {
    await tx.lockRecord(input.recordId);
    const shift = await tx.shift(input.recordId);
    if (shift === null) return fail(MOVEMENT_STALE);
    if (shift.voidedAt !== null) return fail(`${shift.name}'s record has been removed.`);
    if (shift.clockOutAt !== null || shift.signoutMissingAt !== null) {
      return fail(`${shift.name} is not in: their shift is closed, so a movement cannot be recorded for it.`);
    }
    const out = shift.liveMovements.find((movement) => movement.returnedAt === null);
    if (out !== undefined) return fail(`${shift.name} is already recorded as out, since ${timeLabel(out.leftAt)}. Record their return first.`);

    // A time of day on the record's own Lagos day, inside the shift.
    const leftAt = lagosInstantAt(lagosDateOf(shift.clockInAt), parsed.hhmm);
    if (leftAt.getTime() <= shift.clockInAt.getTime()) return fail(`Time left must be after their time in, ${timeLabel(shift.clockInAt)}.`);
    if (leftAt.getTime() > deps.now.getTime()) return fail("That time has not happened yet.");
    const clash = shift.liveMovements.find((movement) => overlaps({ leftAt, returnedAt: null }, movement));
    if (clash !== undefined) {
      return fail(`${shift.name} has another movement recorded from ${timeLabel(clash.leftAt)}${clash.returnedAt ? ` to ${timeLabel(clash.returnedAt)}` : ""}, which overlaps that time.`);
    }

    // The approver: the SAME name rules as the arrivals sheet.
    const roster = await tx.loadRoster();
    const resolution = resolveName(input.approver, roster);
    if (resolution.kind === "problem") return fail(`Approved by: ${resolution.message}`);
    if (resolution.kind === "confirm") {
      return fail(
        `Approved by: ${resolution.typed} is close to ${resolution.candidates.map((c) => c.name).join(", ")}. Say whether it is the same person or a different one.`,
      );
    }
    let approverId: string;
    let approverName: string;
    let created = false;
    if (resolution.kind === "person") {
      approverId = resolution.person.id;
      approverName = resolution.person.name;
    } else {
      approverId = deps.newId();
      approverName = resolution.name;
      created = true;
    }
    if (approverId === shift.staffId) return fail("A person cannot approve their own movement.");

    if (created) {
      await tx.createPerson({ id: approverId, name: approverName, actorId: deps.actorId });
      // Ids and facts only: never the name, which is data about a person.
      await tx.audit({ actorId: deps.actorId, entity: "staff", entityId: approverId, action: "CREATE", after: { roster: true, via: "movement approver" } });
    }
    const id = deps.newId();
    await tx.createMovement({ id, recordId: shift.id, leftAt, destination, purpose, approvedBy: approverId, leftEnteredBy: deps.actorId });
    await tx.audit({
      actorId: deps.actorId,
      entity: "movement",
      entityId: id,
      action: "CREATE",
      after: { attendance_record_id: shift.id, left_at: leftAt.toISOString(), destination, purpose, approved_by: approverId, via: "departure" },
    });
    return { ok: true, message: `${shift.name} is out: ${destination}. Approved by ${approverName}.` };
  });
}

export async function recordReturn(input: { movementId: string; timeReturned: string }, deps: MovementDeps): Promise<MovementResult> {
  const parsed = parseClockTime(input.timeReturned);
  if (!parsed.ok) return fail(parsed.message);
  if (typeof input.movementId !== "string" || input.movementId === "") return fail(MOVEMENT_STALE);

  return deps.store.transaction(async (tx): Promise<MovementResult> => {
    await tx.lockMovement(input.movementId);
    const movement = await tx.movement(input.movementId);
    if (movement === null) return fail(MOVEMENT_STALE);
    // A stale click (the other front-desk person got there first) is a clear message, never a second write.
    if (movement.voidedAt !== null) return fail(`${movement.name}'s movement has been removed.`);
    if (movement.recordVoidedAt !== null) return fail(`${movement.name}'s record has been removed.`);
    if (movement.returnedAt !== null) {
      const by = movement.returnedByName ? ` by ${movement.returnedByName}` : "";
      return fail(`${movement.name} was already recorded as back at ${timeLabel(movement.returnedAt)}${by}.`);
    }

    const returnedAt = lagosInstantAt(lagosDateOf(movement.leftAt), parsed.hhmm);
    if (returnedAt.getTime() <= movement.leftAt.getTime()) return fail(`Time back must be after the time they left, ${timeLabel(movement.leftAt)}.`);
    if (returnedAt.getTime() > deps.now.getTime()) return fail("That time has not happened yet.");
    if (movement.recordClockOutAt !== null && returnedAt.getTime() > movement.recordClockOutAt.getTime()) {
      return fail(`Time back must be before their time out, ${timeLabel(movement.recordClockOutAt)}.`);
    }

    const written = await tx.returnMovement({ id: movement.id, returnedAt, actorId: deps.actorId });
    if (!written) return fail(MOVEMENT_STALE);
    await tx.audit({
      actorId: deps.actorId,
      entity: "movement",
      entityId: movement.id,
      action: "UPDATE",
      before: { returned_at: null },
      after: { returned_at: returnedAt.toISOString(), via: "return" },
    });
    return { ok: true, message: `${movement.name} is back at ${parsed.hhmm}.` };
  });
}
