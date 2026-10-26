// The PostgreSQL side of the visitor log: the VisitStore that check-in, check-out, closing
// the day and corrections are written through, and the reads for screens 03, 05 and the
// dashboard. Every query goes through db.ts (parameterized, errors mapped); nothing here
// opens a connection.
//
// SERVER-ONLY (db.ts throws if loaded in a browser).
//
// LOCKS. A person (a portal client, a visitor, a phone number) is locked with a transaction
// advisory lock on a 64-bit key derived from identityKey()/phoneKey() (there is no row to
// lock FOR UPDATE before their visit exists). A visit is locked person first, then row, the
// same order a check-in takes, so the two cannot interleave. Every write is GUARDED by the
// state its rule checked (and, for a correction, by the version she was looking at).
//
// A REMOVED visit (voided_at, 017) is left out of every list and count below except the
// "Removed" list and the visit's own page.
import { createHash } from "node:crypto";
import { query, sql, transaction as dbTransaction, type Statement, type Tx } from "./db.ts";
import { lagosAddDays, lagosDateOf, lagosDayRange } from "./lagosTime.ts";
import { groupVisitDay, type VisitDay, type VisitRow } from "./visitLog.ts";
import { identityKey, type CloseReason, type LookupOutcome, type VisitCorrection, type VisitRecord, type VisitStore, type VisitTx } from "./visits.ts";

/** A stable signed 64-bit key for pg_advisory_xact_lock(bigint). */
function lockKey(key: string): string {
  return createHash("sha256").update(key).digest().readBigInt64BE(0).toString();
}

type ListRow = {
  id: string;
  version: string;
  name: string;
  is_client: boolean;
  visitor_type_code: string;
  reason_code: string;
  to_see: string | null;
  lookup_outcome: LookupOutcome;
  organisation: string | null;
  checked_in_at: Date;
  checked_in_by_name: string | null;
  checked_out_at: Date | null;
  checked_out_by_name: string | null;
  close_reason: CloseReason | null;
  corrected_at: Date | null;
  corrected_by_name: string | null;
  correction_reason: string | null;
  voided_at: Date | null;
};

const toVisitRow = (row: ListRow): VisitRow => ({
  id: row.id,
  version: row.version,
  name: row.name,
  isClient: row.is_client,
  visitorTypeCode: row.visitor_type_code,
  reasonCode: row.reason_code,
  toSee: row.to_see,
  lookupOutcome: row.lookup_outcome,
  organisation: row.organisation,
  checkedInAt: row.checked_in_at,
  checkedInByName: row.checked_in_by_name,
  checkedOutAt: row.checked_out_at,
  checkedOutByName: row.checked_out_by_name,
  closeReason: row.close_reason,
  correctedAt: row.corrected_at,
  correctedByName: row.corrected_by_name,
  correctionReason: row.correction_reason,
  voidedAt: row.voided_at,
});

/**
 * The visits checked in on a Lagos day (removed ones too, for the Removed list) and, when
 * that day is today, every visit still open from an earlier day. Grouped in visitLog.ts.
 */
export async function loadVisitDay(day: string | Date, now: Date): Promise<VisitDay> {
  const range = lagosDayRange(day);
  const isToday = range.date === lagosDateOf(now);
  const { rows } = await query<ListRow>(sql`
    SELECT v.id, v.updated_at::text AS version, coalesce(v.client_name_logged, vr.display_name) AS name,
           (v.portal_client_id IS NOT NULL) AS is_client, v.visitor_type_code, v.reason_code, v.to_see, v.lookup_outcome,
           vr.organisation, v.checked_in_at, ci.full_name AS checked_in_by_name, v.checked_out_at,
           co.full_name AS checked_out_by_name, v.close_reason, v.corrected_at, cb.full_name AS corrected_by_name,
           v.correction_reason, v.voided_at
      FROM visit v
      LEFT JOIN visitor vr ON vr.id = v.visitor_id
      LEFT JOIN staff ci ON ci.id = v.checked_in_by
      LEFT JOIN staff co ON co.id = v.checked_out_by
      LEFT JOIN staff cb ON cb.id = v.corrected_by
     WHERE (v.checked_in_at >= ${range.start} AND v.checked_in_at < ${range.end})
        OR (${isToday}::boolean AND v.checked_out_at IS NULL AND v.voided_at IS NULL)
     ORDER BY v.checked_in_at`);
  return groupVisitDay(rows.map(toVisitRow), now, range.date);
}

export interface VisitCounts {
  /** Checked in today (Lagos), not removed. */
  today: number;
  /** Open now, from any day, not removed. */
  inBuilding: number;
  /** Of those, checked in before today: forgotten check-outs. */
  inBuildingFromEarlier: number;
  /** Checked in yesterday, not removed: a whole day, so not a like-for-like comparison with today. */
  yesterday: number;
  /** Document handovers recorded today and not withdrawn (018), and how many of them nobody verified. */
  handoversToday: number;
  handoversUnverified: number;
}

/** The dashboard's numbers: counted by the database from real visits, nothing else. */
export async function loadVisitCounts(now: Date): Promise<VisitCounts> {
  const today = lagosDayRange(now);
  const yesterday = lagosDayRange(lagosAddDays(today.date, -1));
  const { rows } = await query<{ today: number; in_building: number; from_earlier: number; yesterday: number }>(sql`
    SELECT count(*) FILTER (WHERE checked_in_at >= ${today.start} AND checked_in_at < ${today.end})::int AS today,
           count(*) FILTER (WHERE checked_out_at IS NULL)::int AS in_building,
           count(*) FILTER (WHERE checked_out_at IS NULL AND checked_in_at < ${today.start})::int AS from_earlier,
           count(*) FILTER (WHERE checked_in_at >= ${yesterday.start} AND checked_in_at < ${yesterday.end})::int AS yesterday
      FROM visit
     WHERE voided_at IS NULL
       AND (checked_in_at >= ${yesterday.start} OR checked_out_at IS NULL)`);
  const row = rows[0]!;
  const handovers = await query<{ total: number; unverified: number }>(sql`
    SELECT count(*)::int AS total,
           count(*) FILTER (WHERE h.gate_answer IN ('GATE_OFF', 'UNAVAILABLE'))::int AS unverified
      FROM handover h
     WHERE h.released_at >= ${today.start} AND h.released_at < ${today.end}
       AND NOT EXISTS (SELECT 1 FROM handover_correction c WHERE c.handover_id = h.id)`);
  return {
    today: row.today,
    inBuilding: row.in_building,
    inBuildingFromEarlier: row.from_earlier,
    yesterday: row.yesterday,
    handoversToday: handovers.rows[0]!.total,
    handoversUnverified: handovers.rows[0]!.unverified,
  };
}

/** The open visits, longest-waiting first, for the dashboard's panel. */
export async function loadOpenVisits(limit: number): Promise<VisitRow[]> {
  const { rows } = await query<ListRow>(sql`
    SELECT v.id, v.updated_at::text AS version, coalesce(v.client_name_logged, vr.display_name) AS name,
           (v.portal_client_id IS NOT NULL) AS is_client, v.visitor_type_code, v.reason_code, v.to_see, v.lookup_outcome,
           vr.organisation, v.checked_in_at, ci.full_name AS checked_in_by_name, v.checked_out_at,
           NULL::text AS checked_out_by_name, v.close_reason, v.corrected_at, cb.full_name AS corrected_by_name,
           v.correction_reason, v.voided_at
      FROM visit v
      LEFT JOIN visitor vr ON vr.id = v.visitor_id
      LEFT JOIN staff ci ON ci.id = v.checked_in_by
      LEFT JOIN staff cb ON cb.id = v.corrected_by
     WHERE v.checked_out_at IS NULL AND v.voided_at IS NULL
     ORDER BY v.checked_in_at
     LIMIT ${limit}`);
  return rows.map(toVisitRow);
}

export interface VisitHistoryEntry {
  at: Date;
  actorName: string | null;
  /** check-in, check-out, end of day, correction */
  via: string;
  /** For a correction: its kind (checkin, reason, void ...). */
  correction: string | null;
  correctionReason: string | null;
}

export type VisitDetail = VisitRow & {
  clientId: string | null;
  visitorId: string | null;
  phone: string | null;
  history: VisitHistoryEntry[];
};

/** One visit for screen 05, with its history from the audit log. Null if there is no such visit. */
export async function loadVisit(id: string): Promise<VisitDetail | null> {
  const { rows } = await query<ListRow & { portal_client_id: string | null; visitor_id: string | null; phone: string | null }>(sql`
    SELECT v.id, v.updated_at::text AS version, coalesce(v.client_name_logged, vr.display_name) AS name,
           (v.portal_client_id IS NOT NULL) AS is_client, v.visitor_type_code, v.reason_code, v.to_see, v.lookup_outcome,
           vr.organisation, v.checked_in_at, ci.full_name AS checked_in_by_name, v.checked_out_at,
           co.full_name AS checked_out_by_name, v.close_reason, v.corrected_at, cb.full_name AS corrected_by_name,
           v.correction_reason, v.voided_at, v.portal_client_id, v.visitor_id, vr.phone
      FROM visit v
      LEFT JOIN visitor vr ON vr.id = v.visitor_id
      LEFT JOIN staff ci ON ci.id = v.checked_in_by
      LEFT JOIN staff co ON co.id = v.checked_out_by
      LEFT JOIN staff cb ON cb.id = v.corrected_by
     WHERE v.id = ${id}::uuid`);
  const row = rows[0];
  if (row === undefined) return null;
  // Every change to this visit, in order (the audit log holds codes and ids only).
  const history = await query<{ at: Date; actor: string | null; via: string | null; correction: string | null; reason: string | null }>(sql`
    SELECT a.at, s.full_name AS actor, a.after->>'via' AS via, a.after->>'correction' AS correction, a.after->>'correction_reason' AS reason
      FROM audit_log a
      LEFT JOIN staff s ON s.id = a.actor_staff_id
     WHERE a.entity = ${"visit"} AND a.entity_id = ${id}
     ORDER BY a.at, a.id`);
  return {
    ...toVisitRow(row),
    clientId: row.portal_client_id,
    visitorId: row.visitor_id,
    phone: row.phone,
    history: history.rows.map((entry) => ({
      at: entry.at,
      actorName: entry.actor,
      via: entry.via ?? "",
      correction: entry.correction,
      correctionReason: entry.reason,
    })),
  };
}

export const pgVisitStore: VisitStore = {
  transaction<T>(work: (tx: VisitTx) => Promise<T>): Promise<T> {
    return dbTransaction(async (db) => {
      const lockIdentity = async (key: string) => {
        await db.query(sql`SELECT pg_advisory_xact_lock(${lockKey(key)}::bigint)`);
      };

      const tx: VisitTx = {
        lockIdentity,

        async lockVisit(visitId) {
          // The person first (their identity never changes), then the row.
          const { rows } = await db.query<{ portal_client_id: string | null; visitor_id: string | null }>(sql`
            SELECT portal_client_id, visitor_id FROM visit WHERE id = ${visitId}::uuid`);
          const row = rows[0];
          if (row === undefined) return;
          await lockIdentity(row.portal_client_id !== null ? identityKey({ clientId: row.portal_client_id }) : identityKey({ visitorId: row.visitor_id! }));
          await db.query(sql`SELECT id FROM visit WHERE id = ${visitId}::uuid FOR UPDATE`);
        },

        async findVisit(visitId) {
          const { rows } = await db.query<{
            id: string;
            version: string;
            name: string;
            portal_client_id: string | null;
            visitor_id: string | null;
            visitor_type_code: string;
            reason_code: string;
            to_see: string | null;
            lookup_outcome: LookupOutcome;
            checked_in_at: Date;
            checked_out_at: Date | null;
            close_reason: CloseReason | null;
            checked_out_by_name: string | null;
            voided_at: Date | null;
            phone: string | null;
            other_open_since: Date | null;
            live_handovers: number;
          }>(sql`
            SELECT v.id, v.updated_at::text AS version, coalesce(v.client_name_logged, vr.display_name) AS name,
                   v.portal_client_id, v.visitor_id, v.visitor_type_code, v.reason_code, v.to_see, v.lookup_outcome,
                   v.checked_in_at, v.checked_out_at, v.close_reason, co.full_name AS checked_out_by_name, v.voided_at, vr.phone,
                   (SELECT o.checked_in_at FROM visit o
                     WHERE o.id <> v.id AND o.checked_out_at IS NULL AND o.voided_at IS NULL
                       AND (o.portal_client_id = v.portal_client_id OR o.visitor_id = v.visitor_id)
                     ORDER BY o.checked_in_at LIMIT 1) AS other_open_since,
                   (SELECT count(*) FROM handover h
                     WHERE h.visit_id = v.id
                       AND NOT EXISTS (SELECT 1 FROM handover_correction c WHERE c.handover_id = h.id))::int AS live_handovers
              FROM visit v
              LEFT JOIN visitor vr ON vr.id = v.visitor_id
              LEFT JOIN staff co ON co.id = v.checked_out_by
             WHERE v.id = ${visitId}::uuid`);
          const row = rows[0];
          if (row === undefined) return null;
          return {
            id: row.id,
            version: row.version,
            name: row.name,
            clientId: row.portal_client_id,
            visitorId: row.visitor_id,
            visitorTypeCode: row.visitor_type_code,
            reasonCode: row.reason_code,
            toSee: row.to_see,
            lookupOutcome: row.lookup_outcome,
            checkedInAt: row.checked_in_at,
            checkedOutAt: row.checked_out_at,
            closeReason: row.close_reason,
            checkedOutByName: row.checked_out_by_name,
            voidedAt: row.voided_at,
            phone: row.phone,
            otherOpenSince: row.other_open_since,
            liveHandovers: row.live_handovers,
          } satisfies VisitRecord;
        },

        async openVisitOf(identity) {
          const clientId = "clientId" in identity ? identity.clientId : null;
          const visitorId = "visitorId" in identity ? identity.visitorId : null;
          const { rows } = await db.query<{ id: string; checked_in_at: Date; by: string | null }>(sql`
            SELECT v.id, v.checked_in_at, s.full_name AS by
              FROM visit v
              LEFT JOIN staff s ON s.id = v.checked_in_by
             WHERE v.checked_out_at IS NULL AND v.voided_at IS NULL
               AND (v.portal_client_id = ${clientId}::uuid OR v.visitor_id = ${visitorId}::uuid)
             ORDER BY v.checked_in_at LIMIT 1`);
          const row = rows[0];
          return row === undefined ? null : { id: row.id, checkedInAt: row.checked_in_at, checkedInByName: row.by };
        },

        async visitorByPhone(phone, exceptVisitorId = null) {
          const { rows } = await db.query<{ id: string; display_name: string; last_visit_at: Date | null }>(sql`
            SELECT vr.id, vr.display_name,
                   (SELECT max(v.checked_in_at) FROM visit v WHERE v.visitor_id = vr.id AND v.voided_at IS NULL) AS last_visit_at
              FROM visitor vr
             WHERE vr.phone = ${phone} AND vr.merged_into_id IS NULL
               AND (${exceptVisitorId}::uuid IS NULL OR vr.id <> ${exceptVisitorId}::uuid)
             LIMIT 1`);
          const row = rows[0];
          return row === undefined ? null : { id: row.id, name: row.display_name, lastVisitAt: row.last_visit_at };
        },

        async insertVisitor(visitor) {
          // consent_at is the database's clock: consent is captured as the record is created.
          await db.query(sql`
            INSERT INTO visitor (id, display_name, organisation, phone, consent_at, created_by)
            VALUES (${visitor.id}, ${visitor.displayName}, ${visitor.organisation}, ${visitor.phone}, now(), ${visitor.createdBy})`);
        },

        async insertVisit(visit) {
          await db.query(sql`
            INSERT INTO visit (id, visitor_type_code, reason_code, portal_client_id, client_name_logged, visitor_id,
                               lookup_outcome, to_see, checked_in_by)
            VALUES (${visit.id}, ${visit.visitorTypeCode}, ${visit.reasonCode}, ${visit.clientId}::uuid, ${visit.clientNameLogged},
                    ${visit.visitorId}::uuid, ${visit.lookupOutcome}, ${visit.toSee}, ${visit.checkedInBy})`);
        },

        async checkOut({ id, actorId }) {
          const { rowCount } = await db.query(sql`
            UPDATE visit SET checked_out_at = now(), checked_out_by = ${actorId}, close_reason = 'NORMAL'
             WHERE id = ${id}::uuid AND checked_out_at IS NULL AND voided_at IS NULL`);
          return rowCount === 1;
        },

        async autoClose({ id, actorId }) {
          // The time is when it was CLOSED; the screens never read it as when they left.
          const { rows } = await db.query<{ checked_out_at: Date }>(sql`
            UPDATE visit SET checked_out_at = now(), checked_out_by = ${actorId}, close_reason = 'AUTO_CLOSED'
             WHERE id = ${id}::uuid AND checked_out_at IS NULL AND voided_at IS NULL
         RETURNING checked_out_at`);
          return rows[0]?.checked_out_at ?? null;
        },

        async applyCorrection({ id, version, actorId, reason, correction }) {
          return (await correct(db, id, version, actorId, reason, correction)) === 1;
        },

        async audit({ actorId, entity, entityId, action, before, after }) {
          await db.query(sql`
            INSERT INTO audit_log (actor_staff_id, entity, entity_id, action, before, after)
            VALUES (${actorId}, ${entity}, ${entityId}, ${action},
                    ${before === null ? null : JSON.stringify(before)}::jsonb, ${JSON.stringify(after)}::jsonb)`);
        },
      };
      return work(tx);
    });
  },
};

/** One guarded UPDATE per kind. Returns the number of visit rows changed (1, or 0 if stale). */
async function correct(db: Tx, id: string, version: string, actorId: string, reason: string, correction: VisitCorrection): Promise<number> {
  // Every branch sets the three correction columns together (017 refuses any other mix) and
  // is guarded by the version she was looking at.
  const live = (statement: Statement) => db.query(statement).then((result) => result.rowCount);
  switch (correction.kind) {
    case "checkin":
      return live(sql`
        UPDATE visit SET checked_in_at = ${correction.checkedInAt},
               corrected_at = now(), corrected_by = ${actorId}, correction_reason = ${reason}
         WHERE id = ${id}::uuid AND voided_at IS NULL AND updated_at = ${version}::timestamptz`);
    case "checkout":
      // A visit closed at the end of the day gets a real time: it becomes an ordinary check-out,
      // still attributed to whoever closed it.
      return live(sql`
        UPDATE visit SET checked_out_at = ${correction.checkedOutAt}, close_reason = 'NORMAL',
               checked_out_by = coalesce(checked_out_by, ${actorId}::uuid),
               corrected_at = now(), corrected_by = ${actorId}, correction_reason = ${reason}
         WHERE id = ${id}::uuid AND voided_at IS NULL AND updated_at = ${version}::timestamptz AND checked_out_at IS NOT NULL`);
    case "reopen":
      return live(sql`
        UPDATE visit SET checked_out_at = NULL, checked_out_by = NULL, close_reason = NULL,
               corrected_at = now(), corrected_by = ${actorId}, correction_reason = ${reason}
         WHERE id = ${id}::uuid AND voided_at IS NULL AND updated_at = ${version}::timestamptz AND checked_out_at IS NOT NULL`);
    case "reason":
      return live(sql`
        UPDATE visit SET reason_code = ${correction.reasonCode},
               corrected_at = now(), corrected_by = ${actorId}, correction_reason = ${reason}
         WHERE id = ${id}::uuid AND voided_at IS NULL AND updated_at = ${version}::timestamptz`);
    case "toSee":
      return live(sql`
        UPDATE visit SET to_see = ${correction.toSee},
               corrected_at = now(), corrected_by = ${actorId}, correction_reason = ${reason}
         WHERE id = ${id}::uuid AND voided_at IS NULL AND updated_at = ${version}::timestamptz`);
    case "type":
      return live(sql`
        UPDATE visit SET visitor_type_code = ${correction.visitorTypeCode},
               corrected_at = now(), corrected_by = ${actorId}, correction_reason = ${reason}
         WHERE id = ${id}::uuid AND voided_at IS NULL AND updated_at = ${version}::timestamptz AND lookup_outcome = 'NOT_LOOKED_UP'`);
    case "name":
    case "phone": {
      // The visit is marked (guarded by its version) and THEN the visitor row is changed.
      const marked = await live(sql`
        UPDATE visit SET corrected_at = now(), corrected_by = ${actorId}, correction_reason = ${reason}
         WHERE id = ${id}::uuid AND voided_at IS NULL AND updated_at = ${version}::timestamptz AND visitor_id = ${correction.visitorId}::uuid`);
      if (marked !== 1) return 0;
      if (correction.kind === "name") {
        await db.query(sql`UPDATE visitor SET display_name = ${correction.displayName} WHERE id = ${correction.visitorId}::uuid`);
      } else {
        await db.query(sql`UPDATE visitor SET phone = ${correction.phone} WHERE id = ${correction.visitorId}::uuid`);
      }
      return 1;
    }
    case "void":
      return live(sql`
        UPDATE visit SET voided_at = now(),
               corrected_at = now(), corrected_by = ${actorId}, correction_reason = ${reason}
         WHERE id = ${id}::uuid AND voided_at IS NULL AND updated_at = ${version}::timestamptz`);
    case "restore":
      return live(sql`
        UPDATE visit SET voided_at = NULL,
               corrected_at = now(), corrected_by = ${actorId}, correction_reason = ${reason}
         WHERE id = ${id}::uuid AND voided_at IS NOT NULL AND updated_at = ${version}::timestamptz`);
  }
}
