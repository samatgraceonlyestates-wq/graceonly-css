// The PostgreSQL side of the today board: reading it, and the DepartureStore that
// clock-outs and "never signed out" marks are written through. Every query goes
// through db.ts (parameterized, errors mapped); nothing here opens a connection.
//
// SERVER-ONLY (db.ts throws if loaded in a browser).
import { query, sql, transaction as dbTransaction } from "./db.ts";
import type { DepartureRecord, DepartureStore, DepartureTx } from "./departures.ts";
import { lagosDateOf, lagosDayRange } from "./lagosTime.ts";
import { groupBoard, type Board, type BoardMovement, type BoardRecord } from "./todayBoard.ts";

/**
 * Today's board (Lagos): the records that started today, plus any shift still OPEN
 * from an earlier day (no clock-out and not marked never-signed-out), and every open
 * movement. The grouping is derived in todayBoard.ts; nothing about it is stored.
 */
export async function loadDayBoard(dayOrNow: string | Date, now: Date): Promise<Board> {
  const range = lagosDayRange(dayOrNow);
  const isToday = range.date === lagosDateOf(now);
  // The version is the row's updated_at as TEXT (microseconds): a JavaScript Date keeps
  // only milliseconds, which could not be compared back to the row.
  const records = await query<{
    id: string;
    staff_id: string;
    full_name: string;
    department: string | null;
    clock_in_at: Date;
    clock_out_at: Date | null;
    signout_missing_at: Date | null;
    version: string;
    corrected_at: Date | null;
    corrected_by_name: string | null;
    correction_reason: string | null;
    voided_at: Date | null;
  }>(sql`
    SELECT r.id, r.staff_id, s.full_name, s.department, r.clock_in_at, r.clock_out_at, r.signout_missing_at,
           r.updated_at::text AS version, r.corrected_at, c.full_name AS corrected_by_name, r.correction_reason, r.voided_at
      FROM attendance_record r
      JOIN staff s ON s.id = r.staff_id
      LEFT JOIN staff c ON c.id = r.corrected_by
     WHERE (r.clock_in_at >= ${range.start} AND r.clock_in_at < ${range.end})
        OR (${isToday}::boolean AND r.clock_out_at IS NULL AND r.signout_missing_at IS NULL AND r.voided_at IS NULL)`);
  // Every movement of the records shown, returned or not, removed or not: the board lists
  // the live ones under each person and the removed ones so they can be restored.
  const recordIds = records.rows.map((row) => row.id);
  const movements = await query<{
    id: string;
    attendance_record_id: string;
    left_at: Date;
    returned_at: Date | null;
    destination: string;
    purpose: string;
    approver: string;
    self_approved: boolean;
    returned_by: string | null;
    version: string;
    corrected_at: Date | null;
    corrected_by_name: string | null;
    correction_reason: string | null;
    voided_at: Date | null;
  }>(sql`
    SELECT m.id, m.attendance_record_id, m.left_at, m.returned_at, m.destination, m.purpose, a.full_name AS approver,
           (m.approved_by = r.staff_id) AS self_approved, rb.full_name AS returned_by, m.updated_at::text AS version, m.corrected_at, c.full_name AS corrected_by_name,
           m.correction_reason, m.voided_at
      FROM movement m
      JOIN attendance_record r ON r.id = m.attendance_record_id
      JOIN staff a ON a.id = m.approved_by
      LEFT JOIN staff rb ON rb.id = m.returned_entered_by
      LEFT JOIN staff c ON c.id = m.corrected_by
     WHERE m.attendance_record_id = ANY(${recordIds}::uuid[])
     ORDER BY m.left_at`);

  return groupBoard(
    records.rows.map(
      (row): BoardRecord => ({
        id: row.id,
        staffId: row.staff_id,
        name: row.full_name,
        department: row.department,
        clockInAt: row.clock_in_at,
        clockOutAt: row.clock_out_at,
        signoutMissingAt: row.signout_missing_at,
        version: row.version,
        correctedAt: row.corrected_at,
        correctedByName: row.corrected_by_name,
        correctionReason: row.correction_reason,
        voidedAt: row.voided_at,
      }),
    ),
    movements.rows.map(
      (row): BoardMovement => ({
        id: row.id,
        recordId: row.attendance_record_id,
        leftAt: row.left_at,
        returnedAt: row.returned_at,
        destination: row.destination,
        purpose: row.purpose,
        approvedByName: row.approver,
        selfApproved: row.self_approved,
        returnedByName: row.returned_by,
        version: row.version,
        correctedAt: row.corrected_at,
        correctedByName: row.corrected_by_name,
        correctionReason: row.correction_reason,
        voidedAt: row.voided_at,
      }),
    ),
    now,
    range.date,
  );
}

/** Today's board (Lagos). */
export function loadTodayBoard(now: Date): Promise<Board> {
  return loadDayBoard(now, now);
}

export const pgDepartureStore: DepartureStore = {
  transaction<T>(work: (tx: DepartureTx) => Promise<T>): Promise<T> {
    return dbTransaction(async (db) => {
      const tx: DepartureTx = {
        async lockRecords(ids) {
          // In id order, so two front-desk users acting on overlapping people cannot deadlock.
          await db.query(sql`SELECT id FROM attendance_record WHERE id = ANY(${[...ids]}::uuid[]) ORDER BY id FOR UPDATE`);
        },

        async recordsByIds(ids) {
          const { rows } = await db.query<{
            id: string;
            staff_id: string;
            full_name: string;
            clock_in_at: Date;
            clock_out_at: Date | null;
            signout_missing_at: Date | null;
            voided_at: Date | null;
            clock_out_by: string | null;
            signout_missing_by: string | null;
            has_open_movement: boolean;
            last_movement_at: Date | null;
          }>(sql`
            SELECT r.id, r.staff_id, s.full_name, r.clock_in_at, r.clock_out_at, r.signout_missing_at, r.voided_at,
                   co.full_name AS clock_out_by, sm.full_name AS signout_missing_by,
                   EXISTS (SELECT 1 FROM movement m WHERE m.attendance_record_id = r.id AND m.returned_at IS NULL AND m.voided_at IS NULL) AS has_open_movement,
                   (SELECT max(greatest(m.left_at, coalesce(m.returned_at, m.left_at)))
                      FROM movement m WHERE m.attendance_record_id = r.id AND m.voided_at IS NULL) AS last_movement_at
              FROM attendance_record r
              JOIN staff s ON s.id = r.staff_id
              LEFT JOIN staff co ON co.id = r.clock_out_entered_by
              LEFT JOIN staff sm ON sm.id = r.signout_missing_by
             WHERE r.id = ANY(${[...ids]}::uuid[])`);
          return rows.map(
            (row): DepartureRecord => ({
              id: row.id,
              staffId: row.staff_id,
              name: row.full_name,
              clockInAt: row.clock_in_at,
              clockOutAt: row.clock_out_at,
              signoutMissingAt: row.signout_missing_at,
              voidedAt: row.voided_at,
              clockOutByName: row.clock_out_by,
              signoutMissingByName: row.signout_missing_by,
              hasOpenMovement: row.has_open_movement,
              lastMovementAt: row.last_movement_at,
            }),
          );
        },

        async clockOut({ id, clockOutAt, actorId }) {
          // Guarded: only a record that is still OPEN. Nothing updated means someone
          // else got there first, which the caller reports.
          const { rows } = await db.query(sql`
            UPDATE attendance_record
               SET clock_out_at = ${clockOutAt}, clock_out_entered_by = ${actorId}
             WHERE id = ${id} AND clock_out_at IS NULL AND signout_missing_at IS NULL AND voided_at IS NULL
         RETURNING id`);
          return rows.length === 1;
        },

        async markNoSignout({ id, actorId }) {
          // The time is the database's clock. The record gets NO clock-out time: its
          // hours are unknown, not zero and not guessed (migration 013).
          const { rows } = await db.query<{ signout_missing_at: Date }>(sql`
            UPDATE attendance_record
               SET signout_missing_at = now(), signout_missing_by = ${actorId}
             WHERE id = ${id} AND clock_out_at IS NULL AND signout_missing_at IS NULL AND voided_at IS NULL
         RETURNING signout_missing_at`);
          return rows[0]?.signout_missing_at ?? null;
        },

        async audit({ actorId, entityId, before, after }) {
          await db.query(sql`
            INSERT INTO audit_log (actor_staff_id, entity, entity_id, action, before, after)
            VALUES (${actorId}, ${"attendance_record"}, ${entityId}, ${"UPDATE"},
                    ${JSON.stringify(before)}::jsonb, ${JSON.stringify(after)}::jsonb)`);
        },
      };
      return work(tx);
    });
  },
};
