// The PostgreSQL implementation of CorrectionStore. Every query goes through db.ts
// (parameterized, errors mapped); nothing here opens a connection.
//
// SERVER-ONLY (db.ts throws if loaded in a browser).
//
// Every UPDATE is GUARDED by the version the person was looking at (updated_at, as text,
// to the microsecond) and by the state its rule just checked, and sets corrected_at,
// corrected_by and correction_reason together (migration 014 refuses any other mix).
// corrected_at is the database's clock.
import { sql, transaction as dbTransaction } from "./db.ts";
import type { Correction, CorrectionRecord, CorrectionStore, CorrectionTx } from "./corrections.ts";

export const pgCorrectionStore: CorrectionStore = {
  transaction<T>(work: (tx: CorrectionTx) => Promise<T>): Promise<T> {
    return dbTransaction(async (db) => {
      const tx: CorrectionTx = {
        async lock(recordId) {
          // The person first, then the record: the same order every correction takes, and
          // the person lock is what arrivals take, so the two cannot interleave.
          await db.query(sql`
            SELECT id FROM staff
             WHERE id = (SELECT staff_id FROM attendance_record WHERE id = ${recordId}::uuid)
               FOR UPDATE`);
          await db.query(sql`SELECT id FROM attendance_record WHERE id = ${recordId}::uuid FOR UPDATE`);
        },

        async find(recordId) {
          const { rows } = await db.query<{
            id: string;
            staff_id: string;
            full_name: string;
            clock_in_at: Date;
            clock_out_at: Date | null;
            signout_missing_at: Date | null;
            voided_at: Date | null;
            version: string;
            movement_count: number;
            first_movement_at: Date | null;
            last_movement_at: Date | null;
            other_open_since: Date | null;
          }>(sql`
            SELECT r.id, r.staff_id, s.full_name, r.clock_in_at, r.clock_out_at, r.signout_missing_at, r.voided_at,
                   r.updated_at::text AS version,
                   (SELECT count(*) FROM movement m WHERE m.attendance_record_id = r.id)::int AS movement_count,
                   (SELECT min(m.left_at) FROM movement m WHERE m.attendance_record_id = r.id) AS first_movement_at,
                   (SELECT max(greatest(m.left_at, coalesce(m.returned_at, m.left_at)))
                      FROM movement m WHERE m.attendance_record_id = r.id) AS last_movement_at,
                   (SELECT o.clock_in_at FROM attendance_record o
                     WHERE o.staff_id = r.staff_id AND o.id <> r.id
                       AND o.clock_out_at IS NULL AND o.signout_missing_at IS NULL AND o.voided_at IS NULL
                     ORDER BY o.clock_in_at LIMIT 1) AS other_open_since
              FROM attendance_record r
              JOIN staff s ON s.id = r.staff_id
             WHERE r.id = ${recordId}::uuid`);
          const row = rows[0];
          if (row === undefined) return null;
          return {
            id: row.id,
            staffId: row.staff_id,
            name: row.full_name,
            clockInAt: row.clock_in_at,
            clockOutAt: row.clock_out_at,
            signoutMissingAt: row.signout_missing_at,
            voidedAt: row.voided_at,
            version: row.version,
            movementCount: row.movement_count,
            firstMovementAt: row.first_movement_at,
            lastMovementAt: row.last_movement_at,
            otherOpenSince: row.other_open_since,
          } satisfies CorrectionRecord;
        },

        async apply({ id, version, actorId, reason, correction }) {
          const rows = await update(id, version, actorId, reason, correction);
          return rows === 1;
        },

        async audit({ actorId, entityId, before, after }) {
          await db.query(sql`
            INSERT INTO audit_log (actor_staff_id, entity, entity_id, action, before, after)
            VALUES (${actorId}, ${"attendance_record"}, ${entityId}, ${"UPDATE"},
                    ${JSON.stringify(before)}::jsonb, ${JSON.stringify(after)}::jsonb)`);
        },
      };

      async function update(id: string, version: string, actorId: string, reason: string, correction: Correction): Promise<number> {
        switch (correction.kind) {
          case "arrival":
            return (
              await db.query(sql`
                UPDATE attendance_record
                   SET clock_in_at = ${correction.clockInAt},
                       corrected_at = now(), corrected_by = ${actorId}, correction_reason = ${reason}
                 WHERE id = ${id} AND voided_at IS NULL AND updated_at = ${version}::timestamptz
             RETURNING id`)
            ).rowCount;
          case "departure":
            // A shift marked never signed out gets its time here: the mark is cleared and the
            // person who typed the time is the corrector. An already-closed shift keeps its author.
            return (
              await db.query(sql`
                UPDATE attendance_record
                   SET clock_out_at = ${correction.clockOutAt},
                       clock_out_entered_by = coalesce(clock_out_entered_by, ${actorId}::uuid),
                       signout_missing_at = NULL, signout_missing_by = NULL,
                       corrected_at = now(), corrected_by = ${actorId}, correction_reason = ${reason}
                 WHERE id = ${id} AND voided_at IS NULL AND updated_at = ${version}::timestamptz
                   AND (clock_out_at IS NOT NULL OR signout_missing_at IS NOT NULL)
             RETURNING id`)
            ).rowCount;
          case "reopen":
            return (
              await db.query(sql`
                UPDATE attendance_record
                   SET clock_out_at = NULL, clock_out_entered_by = NULL,
                       corrected_at = now(), corrected_by = ${actorId}, correction_reason = ${reason}
                 WHERE id = ${id} AND voided_at IS NULL AND updated_at = ${version}::timestamptz
                   AND clock_out_at IS NOT NULL
             RETURNING id`)
            ).rowCount;
          case "unmark":
            return (
              await db.query(sql`
                UPDATE attendance_record
                   SET signout_missing_at = NULL, signout_missing_by = NULL,
                       corrected_at = now(), corrected_by = ${actorId}, correction_reason = ${reason}
                 WHERE id = ${id} AND voided_at IS NULL AND updated_at = ${version}::timestamptz
                   AND signout_missing_at IS NOT NULL
             RETURNING id`)
            ).rowCount;
          case "void":
            return (
              await db.query(sql`
                UPDATE attendance_record
                   SET voided_at = now(),
                       corrected_at = now(), corrected_by = ${actorId}, correction_reason = ${reason}
                 WHERE id = ${id} AND voided_at IS NULL AND updated_at = ${version}::timestamptz
             RETURNING id`)
            ).rowCount;
        }
      }

      return work(tx);
    });
  },
};
