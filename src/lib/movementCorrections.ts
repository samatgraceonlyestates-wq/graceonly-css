// CORRECTING a movement: the same shape as correcting an attendance record (corrections.ts),
// because the lesson from attendance was that no way to correct is a blocker. She will type
// 11:40 where the book says 10:40, the wrong destination, or the wrong approver. The rules
// live here; the database is reached only through MovementCorrectionTx; this file imports
// nothing from Next, `pg` or the browser.
//
//   left          change the time they left
//   returned      change the time they came back
//   destination   change where they went
//   purpose       change what it was for
//   approver      change who approved it (a ROSTER PERSON, by the shared name rules)
//   void          REMOVE a movement entirely (a void, not a delete)
//   restore       UN-REMOVE one removed by mistake
//
// EVERY correction needs a REASON (no default text, no silent fix; the reason is the control,
// not a permission: front desk and admin may both correct), records who and when, writes an
// audit_log row with the before and after, and is checked against the VERSION of the
// movement she was looking at, so a movement someone else changed meanwhile is refused with a
// clear message and nothing written.
//
// A removed movement counts for NOTHING: not "out right now", not in any check. Restoring one
// is refused if it would make the person out twice at once or overlap another movement.
import { parseClockTime } from "./clockTime.ts";
import { NEEDS_REASON, STALE_VERSION, CORRECTION_LIMITS } from "./corrections.ts";
import { timeLabel } from "./departureTime.ts";
import { lagosDateOf, lagosInstantAt } from "./lagosTime.ts";
import { cleanPhrase, MOVEMENT_LIMITS, overlaps, type LiveMovement, type MovementAudit } from "./movements.ts";
import { resolveName, type NameInput } from "./nameResolution.ts";
import type { RosterName } from "./rosterMatch.ts";

export const MOVEMENT_CORRECTION_KINDS = ["left", "returned", "destination", "purpose", "approver", "void", "restore"] as const;
export type MovementCorrectionKind = (typeof MOVEMENT_CORRECTION_KINDS)[number];

export interface CorrectableMovement {
  id: string;
  recordId: string;
  /** The person who left (the attendance record's person). */
  staffId: string;
  name: string;
  leftAt: Date;
  returnedAt: Date | null;
  destination: string;
  purpose: string;
  approvedById: string;
  approvedByName: string;
  voidedAt: Date | null;
  /** The movement's updated_at, as text: changes with every change to it. */
  version: string;
  recordClockInAt: Date;
  recordClockOutAt: Date | null;
  recordVoidedAt: Date | null;
  /** The OTHER live (not removed) movements of the same record. */
  others: LiveMovement[];
}

export type MovementCorrection =
  | { kind: "left"; leftAt: Date }
  | { kind: "returned"; returnedAt: Date }
  | { kind: "destination"; destination: string }
  | { kind: "purpose"; purpose: string }
  | { kind: "approver"; approvedBy: string }
  | { kind: "void" }
  | { kind: "restore" };

export interface MovementCorrectionTx {
  /** Locks the person, the attendance record and the movement, FOR UPDATE, in that order. */
  lock(movementId: string): Promise<void>;
  find(movementId: string): Promise<CorrectableMovement | null>;
  loadRoster(): Promise<RosterName[]>;
  createPerson(input: { id: string; name: string; actorId: string }): Promise<void>;
  /** Guarded by the version and by the state its rule just checked. False if nothing was updated. */
  apply(input: { id: string; version: string; actorId: string; reason: string; correction: MovementCorrection }): Promise<boolean>;
  audit(entry: MovementAudit): Promise<void>;
}

export interface MovementCorrectionStore {
  transaction<T>(work: (tx: MovementCorrectionTx) => Promise<T>): Promise<T>;
}

export interface MovementCorrectionDeps {
  store: MovementCorrectionStore;
  actorId: string;
  now: Date;
  newId: () => string;
}

export interface MovementCorrectionInput {
  movementId: string;
  version: string;
  kind: string;
  /** The new time, for left and returned. */
  time: string;
  destination: string;
  purpose: string;
  approver: NameInput;
  reason: string;
}

export type MovementCorrectionResult = { ok: true; message: string } | { ok: false; message: string };

const fail = (message: string): MovementCorrectionResult => ({ ok: false, message });
const iso = (date: Date | null) => (date === null ? null : date.toISOString());

export async function correctMovement(input: MovementCorrectionInput, deps: MovementCorrectionDeps): Promise<MovementCorrectionResult> {
  // 1. The reason comes first, before anything is read: no correction without one.
  const reason = typeof input.reason === "string" ? input.reason.trim() : "";
  if (reason === "") return fail(NEEDS_REASON);
  if (reason.length > CORRECTION_LIMITS.maxReasonLength) return fail(`Keep the reason under ${CORRECTION_LIMITS.maxReasonLength} characters.`);

  const kind = MOVEMENT_CORRECTION_KINDS.find((candidate) => candidate === input.kind);
  if (kind === undefined) return fail("That kind of correction is not known. Reload the page and try again.");
  if (typeof input.movementId !== "string" || input.movementId === "" || typeof input.version !== "string" || input.version === "") {
    return fail(STALE_VERSION);
  }

  // 2. What the kind needs, checked before the database is touched.
  let hhmm = "";
  let destination = "";
  let purpose = "";
  if (kind === "left" || kind === "returned") {
    const parsed = parseClockTime(input.time);
    if (!parsed.ok) return fail(parsed.message);
    hhmm = parsed.hhmm;
  } else if (kind === "destination") {
    destination = cleanPhrase(input.destination);
    if (destination === "") return fail("Say where they went.");
    if (destination.length > MOVEMENT_LIMITS.maxDestination) return fail(`Keep the destination under ${MOVEMENT_LIMITS.maxDestination} characters.`);
  } else if (kind === "purpose") {
    purpose = cleanPhrase(input.purpose);
    if (purpose === "") return fail("Say what it was for.");
    if (purpose.length > MOVEMENT_LIMITS.maxPurpose) return fail(`Keep the purpose under ${MOVEMENT_LIMITS.maxPurpose} characters.`);
  }

  return deps.store.transaction(async (tx): Promise<MovementCorrectionResult> => {
    await tx.lock(input.movementId);
    const movement = await tx.find(input.movementId);
    if (movement === null) return fail(STALE_VERSION);

    // A removed movement can only be restored; nothing else may touch it.
    if (kind === "restore") {
      if (movement.voidedAt === null) return fail(`${movement.name}'s movement is not removed.`);
    } else if (movement.voidedAt !== null) {
      return fail(`${movement.name}'s movement has been removed. Restore it first to change it.`);
    }
    if (movement.recordVoidedAt !== null) return fail(`${movement.name}'s attendance record has been removed, so this movement cannot be changed.`);
    // Someone else changed it since she opened it: say so, change nothing.
    if (movement.version !== input.version) return fail(STALE_VERSION);

    const day = lagosDateOf(movement.leftAt);
    const left = timeLabel(movement.leftAt);
    let correction: MovementCorrection;
    let before: Record<string, unknown>;
    let after: Record<string, unknown>;
    let message: string;
    let newApprover: { id: string; name: string } | null = null;

    switch (kind) {
      case "left": {
        const at = lagosInstantAt(day, hhmm);
        if (at.getTime() === movement.leftAt.getTime()) return fail(`The time left is already ${left}.`);
        if (at.getTime() > deps.now.getTime()) return fail("That time has not happened yet.");
        if (at.getTime() <= movement.recordClockInAt.getTime()) return fail(`Time left must be after their time in, ${timeLabel(movement.recordClockInAt)}.`);
        if (movement.returnedAt !== null && at.getTime() >= movement.returnedAt.getTime()) {
          return fail(`Time left must be before the time they came back, ${timeLabel(movement.returnedAt)}.`);
        }
        const clash = movement.others.find((other) => overlaps({ leftAt: at, returnedAt: movement.returnedAt }, other));
        if (clash !== undefined) return fail(clashMessage(movement.name, clash));
        correction = { kind, leftAt: at };
        before = { left_at: iso(movement.leftAt) };
        after = { left_at: at.toISOString() };
        message = `${movement.name}: time left changed from ${left} to ${hhmm}.`;
        break;
      }
      case "returned": {
        if (movement.returnedAt === null) return fail(`${movement.name} has not come back yet. Record their return first.`);
        const at = lagosInstantAt(day, hhmm);
        if (at.getTime() === movement.returnedAt.getTime()) return fail(`The time back is already ${timeLabel(movement.returnedAt)}.`);
        if (at.getTime() <= movement.leftAt.getTime()) return fail(`Time back must be after the time they left, ${left}.`);
        if (at.getTime() > deps.now.getTime()) return fail("That time has not happened yet.");
        if (movement.recordClockOutAt !== null && at.getTime() > movement.recordClockOutAt.getTime()) {
          return fail(`Time back must be before their time out, ${timeLabel(movement.recordClockOutAt)}.`);
        }
        const clash = movement.others.find((other) => overlaps({ leftAt: movement.leftAt, returnedAt: at }, other));
        if (clash !== undefined) return fail(clashMessage(movement.name, clash));
        correction = { kind, returnedAt: at };
        before = { returned_at: iso(movement.returnedAt) };
        after = { returned_at: at.toISOString() };
        message = `${movement.name}: time back changed from ${timeLabel(movement.returnedAt)} to ${hhmm}.`;
        break;
      }
      case "destination": {
        if (destination === movement.destination) return fail(`The destination is already ${movement.destination}.`);
        correction = { kind, destination };
        before = { destination: movement.destination };
        after = { destination };
        message = `${movement.name}: destination changed to ${destination}.`;
        break;
      }
      case "purpose": {
        if (purpose === movement.purpose) return fail(`The purpose is already ${movement.purpose}.`);
        correction = { kind, purpose };
        before = { purpose: movement.purpose };
        after = { purpose };
        message = `${movement.name}: purpose changed to ${purpose}.`;
        break;
      }
      case "approver": {
        // The SAME name rules as the arrivals sheet and as recording a departure.
        const roster = await tx.loadRoster();
        const resolution = resolveName(input.approver, roster);
        if (resolution.kind === "problem") return fail(`Approved by: ${resolution.message}`);
        if (resolution.kind === "confirm") {
          return fail(`Approved by: ${resolution.typed} is close to ${resolution.candidates.map((c) => c.name).join(", ")}. Say whether it is the same person or a different one.`);
        }
        const id = resolution.kind === "person" ? resolution.person.id : deps.newId();
        const name = resolution.kind === "person" ? resolution.person.name : resolution.name;
        if (id === movement.staffId) return fail("A person cannot approve their own movement.");
        if (id === movement.approvedById) return fail(`${name} is already the approver.`);
        if (resolution.kind === "create") newApprover = { id, name };
        correction = { kind, approvedBy: id };
        before = { approved_by: movement.approvedById };
        after = { approved_by: id };
        message = `${movement.name}: approver changed to ${name}.`;
        break;
      }
      case "restore": {
        // Putting it back must not break the rules the removal was hiding from.
        if (movement.returnedAt === null && movement.others.some((other) => other.returnedAt === null)) {
          return fail(`${movement.name} is already recorded as out on another movement, so this one cannot be restored.`);
        }
        const clash = movement.others.find((other) => overlaps({ leftAt: movement.leftAt, returnedAt: movement.returnedAt }, other));
        if (clash !== undefined) return fail(clashMessage(movement.name, clash));
        correction = { kind };
        before = { voided: true };
        after = { voided: false };
        message = `${movement.name}'s movement was restored.`;
        break;
      }
      case "void": {
        correction = { kind };
        before = { voided: false };
        after = { voided: true };
        message = `${movement.name}'s movement was removed.`;
        break;
      }
    }

    if (newApprover !== null) {
      await tx.createPerson({ id: newApprover.id, name: newApprover.name, actorId: deps.actorId });
      await tx.audit({ actorId: deps.actorId, entity: "staff", entityId: newApprover.id, action: "CREATE", after: { roster: true, via: "movement approver" } });
    }
    const applied = await tx.apply({ id: movement.id, version: input.version, actorId: deps.actorId, reason, correction });
    if (!applied) return fail(STALE_VERSION);
    await tx.audit({
      actorId: deps.actorId,
      entity: "movement",
      entityId: movement.id,
      action: "UPDATE",
      before,
      after: { ...after, correction: kind, correction_reason: reason, via: "correction" },
    });
    return { ok: true, message };
  });
}

function clashMessage(name: string, other: LiveMovement): string {
  return `${name} has another movement recorded from ${timeLabel(other.leftAt)}${other.returnedAt ? ` to ${timeLabel(other.returnedAt)}` : ""}, which overlaps that time.`;
}
