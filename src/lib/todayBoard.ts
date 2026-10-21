// The front desk's board for today: who is IN, who is OUT on a movement, who has GONE
// for the day, and who was recorded with NO SIGN-OUT. Pure: it groups what the store
// read; it imports nothing from Next, `pg` or the browser. Nothing here is stored:
// every group is derived from the records and the open movements (CLAUDE.md,
// "NEVER STORED: derived values").
//
// A record is in exactly one group:
//   marked never-signed-out (013)     -> NO SIGN-OUT  (its hours are UNKNOWN, never zero)
//   has a clock-out time              -> GONE
//   open, with an open movement       -> OUT  (on a movement right now)
//   open                              -> IN
// An OPEN record from an EARLIER Lagos day is still IN (that is exactly the shift that
// was forgotten, and it blocks that person's next arrival), and is flagged `olderDay`
// so the board can say so. GONE and NO SIGN-OUT are today's records only.
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
}

export interface BoardMovement {
  recordId: string;
  leftAt: Date;
  destination: string;
  purpose: string;
  approvedByName: string;
}

export interface BoardPerson extends BoardRecord {
  /** The Lagos day they arrived (YYYY-MM-DD). */
  arrivedOn: string;
  /** Still open from an earlier Lagos day. Only ever true for IN. */
  olderDay: boolean;
  movement: BoardMovement | null;
}

export interface Board {
  today: string;
  inNow: BoardPerson[];
  outNow: BoardPerson[];
  gone: BoardPerson[];
  noSignout: BoardPerson[];
  counts: { in: number; out: number; gone: number; noSignout: number };
}

const byName = (a: BoardPerson, b: BoardPerson) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }) || a.id.localeCompare(b.id);

export function groupBoard(records: readonly BoardRecord[], openMovements: readonly BoardMovement[], now: Date): Board {
  const today = lagosDateOf(now);
  const movementOf = new Map(openMovements.map((movement) => [movement.recordId, movement]));
  const board: Board = { today, inNow: [], outNow: [], gone: [], noSignout: [], counts: { in: 0, out: 0, gone: 0, noSignout: 0 } };

  for (const record of records) {
    const arrivedOn = lagosDateOf(record.clockInAt);
    const isToday = arrivedOn === today;
    const person: BoardPerson = { ...record, arrivedOn, olderDay: !isToday, movement: movementOf.get(record.id) ?? null };

    if (record.signoutMissingAt !== null) {
      if (isToday) board.noSignout.push(person);
    } else if (record.clockOutAt !== null) {
      if (isToday) board.gone.push(person);
    } else if (person.movement !== null) {
      board.outNow.push(person);
    } else {
      board.inNow.push(person);
    }
  }

  for (const group of [board.inNow, board.outNow, board.gone, board.noSignout]) group.sort(byName);
  board.counts = { in: board.inNow.length, out: board.outNow.length, gone: board.gone.length, noSignout: board.noSignout.length };
  return board;
}
