// The PostgreSQL side of screen 08, the attendance register: READ ONLY. Every query goes through
// db.ts (parameterized, errors mapped); nothing here opens a connection. The rules (the hours,
// late, grouping) are in register.ts.
//
// SERVER-ONLY (db.ts throws if loaded in a browser).
//
// A REMOVED record (voided_at set, 014) is not read at all: it is in no list and no count here,
// as on the board. Only how many there were is read, so the screen can say they are left out.
// A removed MOVEMENT is not counted either (015).
//
// A day is a range of instants from lagosTime.ts; no AT TIME ZONE or cast in these queries.
import { query, sql } from "./db.ts";
import { lagosDaysRange } from "./lagosTime.ts";
import { parseLateAfter, type RegisterLeave, type RegisterRecord, type RegisterStaff } from "./register.ts";

export interface RegisterData {
  records: RegisterRecord[];
  staff: RegisterStaff[];
  leave: RegisterLeave[];
  /** attendance.late_after_local, if it is a readable time of day; null otherwise (no guess). */
  lateAfter: string | null;
  /** Records in the period that were removed: counted for nothing, and only reported as a number. */
  removedCount: number;
}

/** Everything the register shows for the Lagos days `from` to `to`, inclusive. */
export async function loadRegister(from: string, to: string): Promise<RegisterData> {
  const range = lagosDaysRange(from, to);

  // WHO ENTERED each event comes from its own column: the arrival, the departure and a
  // never-signed-out mark are often typed by different people. RESTORED is not a column: a
  // restore is a correction whose kind is in the audit row (corrections.ts), so the LATEST one
  // is read from audit_log, where it survives a later correction overwriting corrected_*.
  const records = await query<{
    id: string;
    staff_id: string;
    full_name: string;
    department: string | null;
    clock_in_at: Date;
    clock_out_at: Date | null;
    signout_missing_at: Date | null;
    clock_in_by: string | null;
    clock_out_by: string | null;
    signout_missing_by: string | null;
    backdate_reason: string | null;
    corrected_at: Date | null;
    corrected_by: string | null;
    correction_reason: string | null;
    restored_at: Date | null;
    restored_by: string | null;
    restored_reason: string | null;
    movements: number;
    self_approved: number;
  }>(sql`
    SELECT r.id, r.staff_id, s.full_name, s.department, r.clock_in_at, r.clock_out_at, r.signout_missing_at,
           ib.full_name AS clock_in_by, ob.full_name AS clock_out_by, sm.full_name AS signout_missing_by,
           r.backdate_reason, r.corrected_at, c.full_name AS corrected_by, r.correction_reason,
           rs.at AS restored_at, rsb.full_name AS restored_by, rs.reason AS restored_reason,
           (SELECT count(*) FROM movement m WHERE m.attendance_record_id = r.id AND m.voided_at IS NULL)::int AS movements,
           (SELECT count(*) FROM movement m
             WHERE m.attendance_record_id = r.id AND m.voided_at IS NULL AND m.approved_by = r.staff_id)::int AS self_approved
      FROM attendance_record r
      JOIN staff s ON s.id = r.staff_id
      LEFT JOIN staff ib ON ib.id = r.clock_in_entered_by
      LEFT JOIN staff ob ON ob.id = r.clock_out_entered_by
      LEFT JOIN staff sm ON sm.id = r.signout_missing_by
      LEFT JOIN staff c ON c.id = r.corrected_by
      LEFT JOIN LATERAL (
            SELECT a.at, a.actor_staff_id, a.after ->> 'correction_reason' AS reason
              FROM audit_log a
             WHERE a.entity = 'attendance_record' AND a.entity_id = r.id::text AND a.after ->> 'correction' = 'restore'
             ORDER BY a.at DESC
             LIMIT 1) rs ON true
      LEFT JOIN staff rsb ON rsb.id = rs.actor_staff_id
     WHERE r.voided_at IS NULL
       AND r.clock_in_at >= ${range.start} AND r.clock_in_at < ${range.end}
     ORDER BY r.clock_in_at`);

  const removed = await query<{ removed: number }>(sql`
    SELECT count(*)::int AS removed FROM attendance_record
     WHERE voided_at IS NOT NULL AND clock_in_at >= ${range.start} AND clock_in_at < ${range.end}`);

  // Everyone who could have a record: the active people. Login accounts are people too (the
  // front desk sign the book like anyone else), so nobody is left out by kind.
  const staff = await query<{ id: string; full_name: string; department: string | null }>(sql`
    SELECT id, full_name, department FROM staff WHERE is_active ORDER BY full_name`);

  // Leave days are `date` columns (Lagos calendar days), compared as dates.
  const leave = await query<{ staff_id: string; starts_on: string; ends_on: string; kind: string }>(sql`
    SELECT l.staff_id, l.starts_on, l.ends_on, k.label AS kind
      FROM leave l
      JOIN leave_kind k ON k.code = l.kind_code
     WHERE l.starts_on <= ${to}::date AND l.ends_on >= ${from}::date`);

  const setting = await query<{ value: unknown }>(sql`SELECT value FROM setting WHERE key = 'attendance.late_after_local'`);

  return {
    records: records.rows.map(
      (row): RegisterRecord => ({
        id: row.id,
        staffId: row.staff_id,
        name: row.full_name,
        department: row.department,
        clockInAt: row.clock_in_at,
        clockOutAt: row.clock_out_at,
        signoutMissingAt: row.signout_missing_at,
        voidedAt: null,
        clockInByName: row.clock_in_by,
        clockOutByName: row.clock_out_by,
        signoutMissingByName: row.signout_missing_by,
        backdateReason: row.backdate_reason,
        correctedAt: row.corrected_at,
        correctedByName: row.corrected_by,
        correctionReason: row.correction_reason,
        restoredAt: row.restored_at,
        restoredByName: row.restored_by,
        restoredReason: row.restored_reason,
        movements: row.movements,
        selfApprovedMovements: row.self_approved,
      }),
    ),
    staff: staff.rows.map((row): RegisterStaff => ({ id: row.id, name: row.full_name, department: row.department })),
    leave: leave.rows.map((row): RegisterLeave => ({ staffId: row.staff_id, startsOn: row.starts_on, endsOn: row.ends_on, kind: row.kind })),
    lateAfter: parseLateAfter(setting.rows[0]?.value),
    removedCount: removed.rows[0]?.removed ?? 0,
  };
}
