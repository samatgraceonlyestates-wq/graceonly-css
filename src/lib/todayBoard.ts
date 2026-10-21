// The front desk's board for a day: who is IN, who is OUT on a movement, who has GONE,
// who was recorded with NO SIGN-OUT, and which records were REMOVED. Pure: it groups
// what the store read; it imports nothing from Next, `pg` or the browser. Nothing here
// is stored: every group is derived from the records and the open movements
// (CLAUDE.md, "NEVER STORED: derived values").
//
// A record is in exactly one group:
//   removed (voided, 014)             -> REMOVED  (kept out of every count and list; shown only in
//                                        its own "Removed records" list, with who, when and why)
//   marked never-signed-out (013)     -> NO SIGN-OUT  (its hours are UNKNOWN, never zero)
//   has a clock-out time              -> GONE
//   open, with an open movement       -> OUT  (on a movement right now)
//   open                              -> IN
// TODAY's board also carries every OPEN record from an EARLIER Lagos day: that is the
// forgotten shift, it blocks that person's next arrival, and it is flagged `olderDay`
// so the board can say so. Looking at an earlier DAY shows only the records that
// started on it; one of those still open is the same forgotten shift (`olderDay`).
import { lagosDateOf } from "./lagosTime.ts";

export interface BoardRecord {
  id: string;
  staffId: string;
  name: string;
  department: string | null;
  clockInAt: Date;
  clockOutAt: Date | null;
  /** Marked never signed out (013): closed, with no time. */
  signoutMissingAt: Date | null;
  /** Changes whenever the record changes: a correction sends back the one it was looking at (014). */
  version: string;
  /** The LATEST correction (014): when, by whom and why. The full history is in audit_log. */
  correctedAt: Date | null;
  correctedByName: string | null;
  correctionReason: string | null;
  /** Removed: entered for the wrong person (014). */
  voidedAt: Date | null;
}

export interface BoardMovement {
  id: string;
  recordId: string;
  leftAt: Date;
  /** Null while they are still out. */
  returnedAt: Date | null;
  destination: string;
  purpose: string;
  approvedByName: string;
  /** Who typed the return (it may not be who typed the departure). */
  returnedByName: string | null;
  /** Changes whenever the movement changes: a correction sends back the one it was looking at (015). */
  version: string;
  /** The LATEST correction (015): when, by whom and why. The full history is in audit_log. */
  correctedAt: Date | null;
  correctedByName: string | null;
  correctionReason: string | null;
  /** Removed (015): counts for nothing. */
  voidedAt: Date | null;
}

export interface BoardPerson extends BoardRecord {
  /** The Lagos day they arrived (YYYY-MM-DD). */
  arrivedOn: string;
  /** Open, and from a Lagos day before today. Only ever true for IN. */
  olderDay: boolean;
  /** The movement they are out on RIGHT NOW (live, not yet returned), if any. */
  movement: BoardMovement | null;
  /** Every LIVE movement of this record, earliest first (the open one included). */
  movements: BoardMovement[];
  /** Movements of this record that were removed: they count for nothing, but are listed so they can be restored. */
  removedMovements: BoardMovement[];
}

export interface Board {
  /** The Lagos day shown (YYYY-MM-DD). */
  day: string;
  /** Today in Lagos. */
  today: string;
  isToday: boolean;
  inNow: BoardPerson[];
  outNow: BoardPerson[];
  gone: BoardPerson[];
  noSignout: BoardPerson[];
  /** Removed records of this day. Not counted anywhere. */
  removed: BoardPerson[];
  counts: { in: number; out: number; gone: number; noSignout: number };
}

const byName = (a: BoardPerson, b: BoardPerson) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }) || a.id.localeCompare(b.id);

export function groupBoard(records: readonly BoardRecord[], allMovements: readonly BoardMovement[], now: Date, day?: string): Board {
  const today = lagosDateOf(now);
  const shown = day ?? today;
  const isToday = shown === today;
  const movementsOf = new Map<string, BoardMovement[]>();
  for (const movement of allMovements) movementsOf.set(movement.recordId, [...(movementsOf.get(movement.recordId) ?? []), movement]);
  const board: Board = { day: shown, today, isToday, inNow: [], outNow: [], gone: [], noSignout: [], removed: [], counts: { in: 0, out: 0, gone: 0, noSignout: 0 } };

  for (const record of records) {
    const arrivedOn = lagosDateOf(record.clockInAt);
    const isOpen = record.clockOutAt === null && record.signoutMissingAt === null && record.voidedAt === null;
    const startedOnDay = arrivedOn === shown;
    // Today's board also carries open shifts from earlier days; no other day does.
    if (!startedOnDay && !(isToday && isOpen && arrivedOn < today)) continue;

    const mine = (movementsOf.get(record.id) ?? []).sort((a, b) => a.leftAt.getTime() - b.leftAt.getTime());
    // A REMOVED movement counts for nothing: it is never "out", whatever its return says.
    const live = mine.filter((movement) => movement.voidedAt === null);
    const person: BoardPerson = {
      ...record,
      arrivedOn,
      olderDay: isOpen && arrivedOn < today,
      movement: live.find((movement) => movement.returnedAt === null) ?? null,
      movements: live,
      removedMovements: mine.filter((movement) => movement.voidedAt !== null),
    };

    if (record.voidedAt !== null) board.removed.push(person);
    else if (record.signoutMissingAt !== null) board.noSignout.push(person);
    else if (record.clockOutAt !== null) board.gone.push(person);
    else if (person.movement !== null) board.outNow.push(person);
    else board.inNow.push(person);
  }

  for (const group of [board.inNow, board.outNow, board.gone, board.noSignout, board.removed]) group.sort(byName);
  board.counts = { in: board.inNow.length, out: board.outNow.length, gone: board.gone.length, noSignout: board.noSignout.length };
  return board;
}
