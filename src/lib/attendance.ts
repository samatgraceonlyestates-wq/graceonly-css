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
