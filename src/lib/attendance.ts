export type AttendanceState = "present" | "late" | "absent" | "leave";

type StaffRecord = { clockInAt: string | null; onLeave?: boolean };

// Derived, never stored: leave wins, then no clock-in is absent, then a
// clock-in after `lateAfterAt` is late, otherwise present.
// `lateAfterAt` is today's late-after instant. In the real system that is the
// office's fixed time of day (09:15 in the design); the sample data moves it
// with its anchored day (see getAttendanceSample).
export function attendanceState(staff: StaffRecord, lateAfterAt: string): AttendanceState {
  if (staff.onLeave) return "leave";
  if (!staff.clockInAt) return "absent";
  return Date.parse(staff.clockInAt) > Date.parse(lateAfterAt) ? "late" : "present";
}

export type ShiftState = "not-clocked-in" | "on-shift" | "complete";

// A person's own shift today, derived from the same record the register uses:
// no clock-in is not clocked in, a clock-in with no clock-out is on shift,
// both is complete.
export function shiftState(record: { clockInAt: string | null; clockOutAt: string | null }): ShiftState {
  if (!record.clockInAt) return "not-clocked-in";
  return record.clockOutAt ? "complete" : "on-shift";
}

// Closed time between a clock-in and clock-out; 0 when the shift is not closed.
export function closedMs(record: { clockInAt: string | null; clockOutAt: string | null }): number {
  if (!record.clockInAt || !record.clockOutAt) return 0;
  return Math.max(0, Date.parse(record.clockOutAt) - Date.parse(record.clockInAt));
}
