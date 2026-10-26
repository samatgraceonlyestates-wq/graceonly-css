// The visit log for one Lagos day, grouped for screen 03 and the dashboard: who is IN the
// building, who has LEFT, and the visits REMOVED (a void, 017). Pure: no I/O. Everything
// here is DERIVED from the rows and never stored (elapsed time, duration, counts).
//
//  * IN THE BUILDING: open (no check-out) and not removed. On TODAY's log this includes a
//    visit left open from an EARLIER day, flagged olderDay, so a forgotten check-out is in
//    front of the desk until somebody closes it. It is not counted in the day's visits.
//  * LEFT: closed and not removed, checked in that day. A visit closed at the END OF THE DAY
//    (AUTO_CLOSED) has NO known length: nobody recorded when they left.
//  * REMOVED: listed apart, so it can be restored, and counted nowhere else.
import { lagosDateOf } from "./lagosTime.ts";
import type { CloseReason, LookupOutcome } from "./visits.ts";

export interface VisitRow {
  id: string;
  version: string;
  name: string;
  isClient: boolean;
  visitorTypeCode: string;
  reasonCode: string;
  toSee: string | null;
  lookupOutcome: LookupOutcome;
  organisation: string | null;
  checkedInAt: Date;
  checkedInByName: string | null;
  checkedOutAt: Date | null;
  checkedOutByName: string | null;
  closeReason: CloseReason | null;
  correctedAt: Date | null;
  correctedByName: string | null;
  correctionReason: string | null;
  voidedAt: Date | null;
}

export type VisitEntry = VisitRow & {
  /** Open, and checked in on a Lagos day before the one shown. */
  olderDay: boolean;
  /** Milliseconds from check-in to check-out, or null while open or when the end was never recorded. */
  lengthMs: number | null;
};

export interface VisitDay {
  day: string;
  isToday: boolean;
  inBuilding: VisitEntry[];
  left: VisitEntry[];
  removed: VisitEntry[];
  counts: {
    /** Visits checked in that day, not removed, open or closed. */
    visits: number;
    inBuilding: number;
    left: number;
    /** Closed at the end of the day: their length is unknown. */
    leftUnknown: number;
    removed: number;
  };
  /** The people in the building, by visitor type code. */
  inBuildingByType: Record<string, number>;
}

export function lengthOf(row: Pick<VisitRow, "checkedInAt" | "checkedOutAt" | "closeReason">): number | null {
  if (row.checkedOutAt === null || row.closeReason === "AUTO_CLOSED") return null;
  return row.checkedOutAt.getTime() - row.checkedInAt.getTime();
}

export function groupVisitDay(rows: readonly VisitRow[], now: Date, day: string): VisitDay {
  const isToday = day === lagosDateOf(now);
  const byTime = [...rows].sort((a, b) => a.checkedInAt.getTime() - b.checkedInAt.getTime());
  const entry = (row: VisitRow): VisitEntry => ({ ...row, olderDay: lagosDateOf(row.checkedInAt) < day, lengthMs: lengthOf(row) });
  const onDay = (row: VisitRow) => lagosDateOf(row.checkedInAt) === day;

  const inBuilding = byTime
    .filter((row) => row.voidedAt === null && row.checkedOutAt === null && (onDay(row) || isToday))
    .map(entry);
  const left = byTime.filter((row) => row.voidedAt === null && row.checkedOutAt !== null && onDay(row)).map(entry);
  const removed = byTime.filter((row) => row.voidedAt !== null && onDay(row)).map(entry);

  const inBuildingByType: Record<string, number> = {};
  for (const visit of inBuilding) inBuildingByType[visit.visitorTypeCode] = (inBuildingByType[visit.visitorTypeCode] ?? 0) + 1;

  return {
    day,
    isToday,
    inBuilding,
    left,
    removed,
    counts: {
      visits: byTime.filter((row) => row.voidedAt === null && onDay(row)).length,
      inBuilding: inBuilding.length,
      left: left.length,
      leftUnknown: left.filter((visit) => visit.lengthMs === null).length,
      removed: removed.length,
    },
    inBuildingByType,
  };
}
