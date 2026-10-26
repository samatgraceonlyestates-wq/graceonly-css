// The PostgreSQL side of the movement book: recording a departure and a return,
// correcting a movement, and the suggestions for where people have gone before. Every
// query goes through db.ts (parameterized, errors mapped); nothing here opens a connection.
//
// SERVER-ONLY (db.ts throws if loaded in a browser).
//
// A REMOVED (voided) movement counts for nothing: every query below that asks "who is out",
// "what else is there for this person" or "what has been used before" leaves it out
// (migration 015). Every UPDATE of a movement is GUARDED by the version the person was
// looking at (updated_at as text, to the microsecond) and by the state its rule just
// checked, and sets corrected_at, corrected_by and correction_reason together.
import { query, sql, transaction as dbTransaction, type Tx } from "./db.ts";
import type { CorrectableMovement, MovementCorrectionStore, MovementCorrectionTx } from "./movementCorrections.ts";
import type { ExistingMovement, LiveMovement, MovementAudit, MovementPhrases, MovementShift, MovementStore, MovementTx } from "./movements.ts";
import type { RosterName } from "./rosterMatch.ts";

// ---- the parts both transactions share ---------------------------------------------------

async function lockPersonAndRecord(db: Tx, recordId: string): Promise<void> {
  // The person first, then the record: the order every attendance write takes, and the
  // person lock is what arrivals take, so these cannot interleave with a batch.
  await db.query(sql`
    SELECT id FROM staff
     WHERE id = (SELECT staff_id FROM attendance_record WHERE id = ${recordId}::uuid)
       FOR UPDATE`);
  await db.query(sql`SELECT id FROM attendance_record WHERE id = ${recordId}::uuid FOR UPDATE`);
}

async function lockThroughMovement(db: Tx, movementId: string): Promise<void> {
  const { rows } = await db.query<{ attendance_record_id: string }>(sql`
    SELECT attendance_record_id FROM movement WHERE id = ${movementId}::uuid`);
  const recordId = rows[0]?.attendance_record_id;
  if (recordId === undefined) return;
  await lockPersonAndRecord(db, recordId);
  await db.query(sql`SELECT id FROM movement WHERE id = ${movementId}::uuid FOR UPDATE`);
}

async function loadRoster(db: Tx): Promise<RosterName[]> {
  const { rows } = await db.query<{ id: string; full_name: string; department: string | null }>(sql`
    SELECT id, full_name, department FROM staff WHERE is_active ORDER BY full_name`);
  return rows.map((row): RosterName => ({ id: row.id, name: row.full_name, department: row.department }));
}

/**
 * The destinations and purposes already used, most used first, ONE spelling each: spellings
 * that differ only by case or spacing are one phrase (the key below is phraseKey in
 * phraseMatch.ts), and the spelling kept is the one used most (the earliest on a tie), so it
 * does not change under her. Removed movements are left out. The SAME list is sent to the
 * screen (suggestions, the close-phrase question) and read in the transaction (the check), so
 * the two cannot disagree. Matched in the application, as the roster is: no index, no extension.
 */
async function loadPhrases(db: Pick<Tx, "query">): Promise<MovementPhrases> {
  const destinations = await db.query<{ phrase: string }>(sql`
    WITH spelling AS (
      SELECT destination AS phrase, lower(regexp_replace(destination, '[[:space:]]+', '', 'g')) AS key,
             count(*) AS uses, min(created_at) AS first_at, max(created_at) AS last_at
        FROM movement WHERE voided_at IS NULL
       GROUP BY destination)
    SELECT (array_agg(phrase ORDER BY uses DESC, first_at))[1] AS phrase
      FROM spelling GROUP BY key
     ORDER BY sum(uses) DESC, max(last_at) DESC`);
  const purposes = await db.query<{ phrase: string }>(sql`
    WITH spelling AS (
      SELECT purpose AS phrase, lower(regexp_replace(purpose, '[[:space:]]+', '', 'g')) AS key,
             count(*) AS uses, min(created_at) AS first_at, max(created_at) AS last_at
        FROM movement WHERE voided_at IS NULL
       GROUP BY purpose)
    SELECT (array_agg(phrase ORDER BY uses DESC, first_at))[1] AS phrase
      FROM spelling GROUP BY key
     ORDER BY sum(uses) DESC, max(last_at) DESC`);
  return { destinations: destinations.rows.map((row) => row.phrase), purposes: purposes.rows.map((row) => row.phrase) };
}

async function createPerson(db: Tx, input: { id: string; name: string }): Promise<void> {
  // A roster person: a name and nothing else. No password, email or department.
  await db.query(sql`INSERT INTO staff (id, full_name) VALUES (${input.id}, ${input.name})`);
}

async function audit(db: Tx, entry: MovementAudit): Promise<void> {
  await db.query(sql`
    INSERT INTO audit_log (actor_staff_id, entity, entity_id, action, before, after)
    VALUES (${entry.actorId}, ${entry.entity}, ${entry.entityId}, ${entry.action},
            ${entry.before === undefined ? null : JSON.stringify(entry.before)}::jsonb, ${JSON.stringify(entry.after)}::jsonb)`);
}

async function liveMovementsOf(db: Tx, recordId: string, exceptId: string | null): Promise<LiveMovement[]> {
  const { rows } = await db.query<{ id: string; left_at: Date; returned_at: Date | null }>(sql`
    SELECT id, left_at, returned_at
      FROM movement
     WHERE attendance_record_id = ${recordId}::uuid AND voided_at IS NULL
       AND (${exceptId}::uuid IS NULL OR id <> ${exceptId}::uuid)
     ORDER BY left_at`);
  return rows.map((row): LiveMovement => ({ id: row.id, leftAt: row.left_at, returnedAt: row.returned_at }));
}

// ---- recording a departure and a return --------------------------------------------------

export const pgMovementStore: MovementStore = {
  transaction<T>(work: (tx: MovementTx) => Promise<T>): Promise<T> {
    return dbTransaction(async (db) => {
      const tx: MovementTx = {
        lockRecord: (recordId) => lockPersonAndRecord(db, recordId),
        lockMovement: (movementId) => lockThroughMovement(db, movementId),
        loadRoster: () => loadRoster(db),
        loadPhrases: () => loadPhrases(db),

        async shift(recordId) {
          const { rows } = await db.query<{
            id: string;
            staff_id: string;
            full_name: string;
            clock_in_at: Date;
            clock_out_at: Date | null;
            signout_missing_at: Date | null;
            voided_at: Date | null;
          }>(sql`
            SELECT r.id, r.staff_id, s.full_name, r.clock_in_at, r.clock_out_at, r.signout_missing_at, r.voided_at
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
            liveMovements: await liveMovementsOf(db, row.id, null),
          } satisfies MovementShift;
        },

        async movement(movementId) {
          const { rows } = await db.query<{
            id: string;
            attendance_record_id: string;
            staff_id: string;
            full_name: string;
            left_at: Date;
            returned_at: Date | null;
            returned_by: string | null;
            voided_at: Date | null;
            record_clock_out_at: Date | null;
            record_voided_at: Date | null;
          }>(sql`
            SELECT m.id, m.attendance_record_id, r.staff_id, s.full_name, m.left_at, m.returned_at, rb.full_name AS returned_by,
                   m.voided_at, r.clock_out_at AS record_clock_out_at, r.voided_at AS record_voided_at
              FROM movement m
              JOIN attendance_record r ON r.id = m.attendance_record_id
              JOIN staff s ON s.id = r.staff_id
              LEFT JOIN staff rb ON rb.id = m.returned_entered_by
             WHERE m.id = ${movementId}::uuid`);
          const row = rows[0];
          if (row === undefined) return null;
          return {
            id: row.id,
            recordId: row.attendance_record_id,
            staffId: row.staff_id,
            name: row.full_name,
            leftAt: row.left_at,
            returnedAt: row.returned_at,
            returnedByName: row.returned_by,
            voidedAt: row.voided_at,
            recordClockOutAt: row.record_clock_out_at,
            recordVoidedAt: row.record_voided_at,
          } satisfies ExistingMovement;
        },

        createPerson: (input) => createPerson(db, input),

        async createMovement(movement) {
          // The device columns stay NULL: no device is registered (see arrivalStore.ts).
          await db.query(sql`
            INSERT INTO movement (id, attendance_record_id, left_at, destination, purpose, approved_by, left_entered_by)
            VALUES (${movement.id}, ${movement.recordId}, ${movement.leftAt}, ${movement.destination}, ${movement.purpose},
                    ${movement.approvedBy}, ${movement.leftEnteredBy})`);
        },

        async returnMovement({ id, returnedAt, actorId }) {
          const { rows } = await db.query(sql`
            UPDATE movement
               SET returned_at = ${returnedAt}, returned_entered_by = ${actorId}
             WHERE id = ${id} AND returned_at IS NULL AND voided_at IS NULL
         RETURNING id`);
          return rows.length === 1;
        },

        audit: (entry) => audit(db, entry),
      };
      return work(tx);
    });
  },
};

// ---- correcting a movement ---------------------------------------------------------------

export const pgMovementCorrectionStore: MovementCorrectionStore = {
  transaction<T>(work: (tx: MovementCorrectionTx) => Promise<T>): Promise<T> {
    return dbTransaction(async (db) => {
      const tx: MovementCorrectionTx = {
        lock: (movementId) => lockThroughMovement(db, movementId),
        loadRoster: () => loadRoster(db),
        loadPhrases: () => loadPhrases(db),
        createPerson: (input) => createPerson(db, input),
        audit: (entry) => audit(db, entry),

        async find(movementId) {
          const { rows } = await db.query<{
            id: string;
            attendance_record_id: string;
            staff_id: string;
            full_name: string;
            left_at: Date;
            returned_at: Date | null;
            destination: string;
            purpose: string;
            approved_by: string;
            approver: string;
            voided_at: Date | null;
            version: string;
            clock_in_at: Date;
            clock_out_at: Date | null;
            record_voided_at: Date | null;
          }>(sql`
            SELECT m.id, m.attendance_record_id, r.staff_id, s.full_name, m.left_at, m.returned_at, m.destination, m.purpose,
                   m.approved_by, a.full_name AS approver, m.voided_at, m.updated_at::text AS version,
                   r.clock_in_at, r.clock_out_at, r.voided_at AS record_voided_at
              FROM movement m
              JOIN attendance_record r ON r.id = m.attendance_record_id
              JOIN staff s ON s.id = r.staff_id
              JOIN staff a ON a.id = m.approved_by
             WHERE m.id = ${movementId}::uuid`);
          const row = rows[0];
          if (row === undefined) return null;
          return {
            id: row.id,
            recordId: row.attendance_record_id,
            staffId: row.staff_id,
            name: row.full_name,
            leftAt: row.left_at,
            returnedAt: row.returned_at,
            destination: row.destination,
            purpose: row.purpose,
            approvedById: row.approved_by,
            approvedByName: row.approver,
            voidedAt: row.voided_at,
            version: row.version,
            recordClockInAt: row.clock_in_at,
            recordClockOutAt: row.clock_out_at,
            recordVoidedAt: row.record_voided_at,
            others: await liveMovementsOf(db, row.attendance_record_id, row.id),
          } satisfies CorrectableMovement;
        },

        async apply({ id, version, actorId, reason, correction }) {
          switch (correction.kind) {
            case "left":
              return (
                await db.query(sql`
                  UPDATE movement
                     SET left_at = ${correction.leftAt}, corrected_at = now(), corrected_by = ${actorId}, correction_reason = ${reason}
                   WHERE id = ${id} AND voided_at IS NULL AND updated_at = ${version}::timestamptz
               RETURNING id`)
              ).rowCount === 1;
            case "returned":
              return (
                await db.query(sql`
                  UPDATE movement
                     SET returned_at = ${correction.returnedAt}, corrected_at = now(), corrected_by = ${actorId}, correction_reason = ${reason}
                   WHERE id = ${id} AND voided_at IS NULL AND returned_at IS NOT NULL AND updated_at = ${version}::timestamptz
               RETURNING id`)
              ).rowCount === 1;
            case "destination":
              return (
                await db.query(sql`
                  UPDATE movement
                     SET destination = ${correction.destination}, corrected_at = now(), corrected_by = ${actorId}, correction_reason = ${reason}
                   WHERE id = ${id} AND voided_at IS NULL AND updated_at = ${version}::timestamptz
               RETURNING id`)
              ).rowCount === 1;
            case "purpose":
              return (
                await db.query(sql`
                  UPDATE movement
                     SET purpose = ${correction.purpose}, corrected_at = now(), corrected_by = ${actorId}, correction_reason = ${reason}
                   WHERE id = ${id} AND voided_at IS NULL AND updated_at = ${version}::timestamptz
               RETURNING id`)
              ).rowCount === 1;
            case "approver":
              return (
                await db.query(sql`
                  UPDATE movement
                     SET approved_by = ${correction.approvedBy}, corrected_at = now(), corrected_by = ${actorId}, correction_reason = ${reason}
                   WHERE id = ${id} AND voided_at IS NULL AND updated_at = ${version}::timestamptz
               RETURNING id`)
              ).rowCount === 1;
            case "void":
              return (
                await db.query(sql`
                  UPDATE movement
                     SET voided_at = now(), corrected_at = now(), corrected_by = ${actorId}, correction_reason = ${reason}
                   WHERE id = ${id} AND voided_at IS NULL AND updated_at = ${version}::timestamptz
               RETURNING id`)
              ).rowCount === 1;
            case "restore":
              return (
                await db.query(sql`
                  UPDATE movement
                     SET voided_at = NULL, corrected_at = now(), corrected_by = ${actorId}, correction_reason = ${reason}
                   WHERE id = ${id} AND voided_at IS NOT NULL AND updated_at = ${version}::timestamptz
               RETURNING id`)
              ).rowCount === 1;
          }
        },
      };
      return work(tx);
    });
  },
};

// ---- what has been used before -----------------------------------------------------------

/** The phrase lists for the screen: the same query the transactions check against. */
export function loadMovementSuggestions(): Promise<MovementPhrases> {
  return loadPhrases({ query });
}
