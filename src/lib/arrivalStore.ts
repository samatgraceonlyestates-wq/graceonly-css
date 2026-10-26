// The PostgreSQL implementation of ArrivalStore. Every query goes through db.ts
// (parameterized, errors mapped); nothing here opens a connection.
//
// SERVER-ONLY (db.ts throws if loaded in a browser).
//
// The device columns are left NULL: no device is registered (the table is empty, no
// reception computer yet), so there is no id and no kind to record, and the pair
// check (attendance_clock_in_device_pair_check) requires both or neither. When a
// desk device exists, the session carries it and this is where it is written.
import { query, sql, transaction as dbTransaction } from "./db.ts";
import { lagosDateOf } from "./lagosTime.ts";
import type { ArrivalStore, ArrivalTx, ExistingShift } from "./arrivalBatch.ts";
import { parseLateAfter } from "./register.ts";
import type { RosterName } from "./rosterMatch.ts";

/** Everyone who is active: the roster the arrivals screen suggests from. */
export async function loadArrivalRoster(): Promise<RosterName[]> {
  const { rows } = await query<{ id: string; full_name: string; department: string | null; created_at: Date }>(sql`
    SELECT id, full_name, department, created_at FROM staff WHERE is_active ORDER BY full_name`);
  return rows.map((row): RosterName => ({ id: row.id, name: row.full_name, department: row.department, since: lagosDateOf(row.created_at) }));
}

export const pgArrivalStore: ArrivalStore = {
  transaction<T>(work: (tx: ArrivalTx) => Promise<T>): Promise<T> {
    return dbTransaction(async (db) => {
      const tx: ArrivalTx = {
        // Inside the transaction, so the names it resolves against are the ones it locks.
        async loadRoster() {
          const { rows } = await db.query<{ id: string; full_name: string; department: string | null; created_at: Date }>(sql`
            SELECT id, full_name, department, created_at FROM staff WHERE is_active ORDER BY full_name`);
          return rows.map((row): RosterName => ({ id: row.id, name: row.full_name, department: row.department, since: lagosDateOf(row.created_at) }));
        },

        async lockPeople(ids) {
          // In id order, so two front-desk users saving overlapping batches lock in
          // the same order and cannot deadlock.
          await db.query(sql`SELECT id FROM staff WHERE id = ANY(${[...ids]}::uuid[]) ORDER BY id FOR UPDATE`);
        },

        async shiftsFor(ids, day) {
          // OPEN means no clock-out AND not marked never-signed-out (013).
          const { rows } = await db.query<{ staff_id: string; clock_in_at: Date; clock_out_at: Date | null; signout_missing_at: Date | null }>(sql`
            SELECT staff_id, clock_in_at, clock_out_at, signout_missing_at
              FROM attendance_record
             WHERE staff_id = ANY(${[...ids]}::uuid[])
               AND voided_at IS NULL
               AND ((clock_in_at >= ${day.start} AND clock_in_at < ${day.end})
                    OR (clock_out_at IS NULL AND signout_missing_at IS NULL))`);
          return rows.map(
            (row): ExistingShift => ({
              staffId: row.staff_id,
              clockInAt: row.clock_in_at,
              clockOutAt: row.clock_out_at,
              signoutMissing: row.signout_missing_at !== null,
            }),
          );
        },

        async createPerson({ id, name }) {
          // A roster person: a name and nothing else. No password, email or department.
          await db.query(sql`INSERT INTO staff (id, full_name) VALUES (${id}, ${name})`);
        },

        async lateAfterLocal() {
          // A snapshot for the record (016): read as a time of day here, or not at all.
          const { rows } = await db.query<{ value: unknown }>(sql`SELECT value FROM setting WHERE key = 'attendance.late_after_local'`);
          return parseLateAfter(rows[0]?.value);
        },

        async createRecord(record) {
          await db.query(sql`
            INSERT INTO attendance_record
              (id, staff_id, clock_in_at, clock_out_at, clock_in_entered_by, clock_out_entered_by, backdate_reason,
               late_after_local, signout_missing_at, signout_missing_by)
            VALUES
              (${record.id}, ${record.staffId}, ${record.clockInAt}, ${record.clockOutAt},
               ${record.clockInEnteredBy}, ${record.clockOutEnteredBy}, ${record.backdateReason}, ${record.lateAfterLocal},
               CASE WHEN ${record.signoutMissing}::boolean THEN now() END,
               CASE WHEN ${record.signoutMissing}::boolean THEN ${record.clockInEnteredBy}::uuid END)`);
        },

        async audit({ actorId, entity, entityId, after }) {
          await db.query(sql`
            INSERT INTO audit_log (actor_staff_id, entity, entity_id, action, after)
            VALUES (${actorId}, ${entity}, ${entityId}, ${"CREATE"}, ${JSON.stringify(after)}::jsonb)`);
        },
      };
      return work(tx);
    });
  },
};
