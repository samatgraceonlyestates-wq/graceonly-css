// The PostgreSQL side of the today board: reading it, and the DepartureStore that
// clock-outs and "never signed out" marks are written through. Every query goes
// through db.ts (parameterized, errors mapped); nothing here opens a connection.
//
// SERVER-ONLY (db.ts throws if loaded in a browser).
import { query, sql, transaction as dbTransaction } from "./db.ts";
import type { DepartureRecord, DepartureStore, DepartureTx } from "./departures.ts";
import { lagosDayRange } from "./lagosTime.ts";
import { groupBoard, type Board, type BoardMovement, type BoardRecord } from "./todayBoard.ts";

/**
 * Today's board (Lagos): the records that started today, plus any shift still OPEN
 * from an earlier day (no clock-out and not marked never-signed-out), and every open
 * movement. The grouping is derived in todayBoard.ts; nothing about it is stored.
 */
export async function loadTodayBoard(now: Date): Promise<Board> {
  const day = lagosDayRange(now);
  const records = await query<{
    id: string;
    staff_id: string;
    full_name: string;
    department: string | null;
    clock_in_at: Date;
    clock_out_at: Date | null;
    signout_missing_at: Date | null;
  }>(sql`
    SELECT r.id, r.staff_id, s.full_name, s.department, r.clock_in_at, r.clock_out_at, r.signout_missing_at
      FROM attendance_record r
      JOIN staff s ON s.id = r.staff_id
     WHERE (r.clock_in_at >= ${day.start} AND r.clock_in_at < ${day.end})
        OR (r.clock_out_at IS NULL AND r.signout_missing_at IS NULL)`);
  const movements = await query<{
    attendance_record_id: string;
    left_at: Date;
    destination: string;
    purpose: string;
    approver: string;
  }>(sql`
    SELECT m.attendance_record_id, m.left_at, m.destination, m.purpose, a.full_name AS approver
      FROM movement m
      JOIN staff a ON a.id = m.approved_by
     WHERE m.returned_at IS NULL`);

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
      }),
    ),
    movements.rows.map(
      (row): BoardMovement => ({
        recordId: row.attendance_record_id,
        leftAt: row.left_at,
        destination: row.destination,
        purpose: row.purpose,
        approvedByName: row.approver,
      }),
    ),
    now,
  );
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
            has_open_movement: boolean;
            last_movement_at: Date | null;
          }>(sql`
            SELECT r.id, r.staff_id, s.full_name, r.clock_in_at, r.clock_out_at, r.signout_missing_at,
                   EXISTS (SELECT 1 FROM movement m WHERE m.attendance_record_id = r.id AND m.returned_at IS NULL) AS has_open_movement,
                   (SELECT max(greatest(m.left_at, coalesce(m.returned_at, m.left_at)))
                      FROM movement m WHERE m.attendance_record_id = r.id) AS last_movement_at
              FROM attendance_record r
              JOIN staff s ON s.id = r.staff_id
             WHERE r.id = ANY(${[...ids]}::uuid[])`);
          return rows.map(
            (row): DepartureRecord => ({
              id: row.id,
              staffId: row.staff_id,
              name: row.full_name,
              clockInAt: row.clock_in_at,
              clockOutAt: row.clock_out_at,
              signoutMissingAt: row.signout_missing_at,
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
             WHERE id = ${id} AND clock_out_at IS NULL AND signout_missing_at IS NULL
         RETURNING id`);
          return rows.length === 1;
        },

        async markNoSignout({ id, actorId }) {
          // The time is the database's clock. The record gets NO clock-out time: its
          // hours are unknown, not zero and not guessed (migration 013).
          const { rows } = await db.query<{ signout_missing_at: Date }>(sql`
            UPDATE attendance_record
               SET signout_missing_at = now(), signout_missing_by = ${actorId}
             WHERE id = ${id} AND clock_out_at IS NULL AND signout_missing_at IS NULL
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
