// The PostgreSQL side of document handovers: the HandoverStore the rules write through, and
// the read for a visit's handovers (screen 05). Every query goes through db.ts; nothing here
// opens a connection. handover, handover_item and handover_correction are APPEND-ONLY (007, 018):
// this file only ever INSERTs into them, and FOR UPDATE (which fires no trigger) to serialise.
//
// SERVER-ONLY (db.ts throws if loaded in a browser).
import { query, sql, transaction as dbTransaction } from "./db.ts";
import {
  assembleHandovers,
  type GateAnswer,
  type HandoverCorrectionRow,
  type HandoverRef,
  type HandoverRow,
  type HandoverStore,
  type HandoverTx,
  type HandoverView,
  type HandoverVisit,
} from "./handovers.ts";

type VisitRow = { id: string; name: string; portal_client_id: string | null; voided_at: Date | null };

const VISIT = (id: string) => sql`
  SELECT v.id, coalesce(v.client_name_logged, vr.display_name) AS name, v.portal_client_id, v.voided_at
    FROM visit v LEFT JOIN visitor vr ON vr.id = v.visitor_id
   WHERE v.id = ${id}::uuid`;

const toVisit = (row: VisitRow | undefined): HandoverVisit | null =>
  row === undefined ? null : { id: row.id, name: row.name, clientId: row.portal_client_id, voidedAt: row.voided_at };

/** A visit's handovers, oldest first, each WITH its correction and its replacement links. */
export async function loadHandovers(visitId: string): Promise<HandoverView[]> {
  const handovers = await query<{
    id: string;
    released_at: Date;
    released_by_name: string | null;
    portal_purchase_id: string | null;
    gate_answer: GateAnswer;
    gate_request_id: string | null;
    note: string | null;
    replaces_handover_id: string | null;
  }>(sql`
    SELECT h.id, h.released_at, s.full_name AS released_by_name, h.portal_purchase_id, h.gate_answer, h.gate_request_id,
           h.note, h.replaces_handover_id
      FROM handover h
      LEFT JOIN staff s ON s.id = h.released_by
     WHERE h.visit_id = ${visitId}::uuid
     ORDER BY h.released_at, h.id`);
  const ids = handovers.rows.map((row) => row.id);
  const [items, corrections] = await Promise.all([
    query<{ handover_id: string; document_type_code: string; quantity: number }>(sql`
      SELECT handover_id, document_type_code, quantity FROM handover_item WHERE handover_id = ANY(${ids}::uuid[])`),
    query<{ handover_id: string; reason: string; corrected_at: Date; corrected_by_name: string | null }>(sql`
      SELECT c.handover_id, c.reason, c.corrected_at, s.full_name AS corrected_by_name
        FROM handover_correction c
        LEFT JOIN staff s ON s.id = c.corrected_by
       WHERE c.handover_id = ANY(${ids}::uuid[])`),
  ]);
  return assembleHandovers(
    handovers.rows.map(
      (row): HandoverRow => ({
        id: row.id,
        releasedAt: row.released_at,
        releasedByName: row.released_by_name,
        purchaseId: row.portal_purchase_id,
        gateAnswer: row.gate_answer,
        gateRequestId: row.gate_request_id,
        note: row.note,
        replacesId: row.replaces_handover_id,
      }),
    ),
    items.rows.map((row) => ({ handoverId: row.handover_id, code: row.document_type_code, quantity: row.quantity })),
    corrections.rows.map(
      (row): HandoverCorrectionRow => ({ handoverId: row.handover_id, reason: row.reason, correctedAt: row.corrected_at, correctedByName: row.corrected_by_name }),
    ),
  );
}

export const pgHandoverStore: HandoverStore = {
  async visit(visitId) {
    return toVisit((await query<VisitRow>(VISIT(visitId))).rows[0]);
  },

  transaction<T>(work: (tx: HandoverTx) => Promise<T>): Promise<T> {
    return dbTransaction(async (db) => {
      const tx: HandoverTx = {
        async lockVisit(visitId) {
          // The same row a visit correction locks, so a visit cannot be removed while a handover
          // is being written to it (visits.ts refuses to remove a visit with live handovers).
          await db.query(sql`SELECT id FROM visit WHERE id = ${visitId}::uuid FOR UPDATE`);
        },

        async findVisit(visitId) {
          return toVisit((await db.query<VisitRow>(VISIT(visitId))).rows[0]);
        },

        async lockHandover(id) {
          await db.query(sql`SELECT id FROM handover WHERE id = ${id}::uuid FOR UPDATE`);
        },

        async findHandover(id) {
          const { rows } = await db.query<{
            id: string;
            visit_id: string;
            released_at: Date;
            withdrawn_at: Date | null;
            withdrawn_by: string | null;
            replaced_by: string | null;
          }>(sql`
            SELECT h.id, h.visit_id, h.released_at, c.corrected_at AS withdrawn_at, s.full_name AS withdrawn_by,
                   (SELECT r.id FROM handover r WHERE r.replaces_handover_id = h.id) AS replaced_by
              FROM handover h
              LEFT JOIN handover_correction c ON c.handover_id = h.id
              LEFT JOIN staff s ON s.id = c.corrected_by
             WHERE h.id = ${id}::uuid`);
          const row = rows[0];
          return row === undefined
            ? null
            : ({
                id: row.id,
                visitId: row.visit_id,
                releasedAt: row.released_at,
                withdrawnAt: row.withdrawn_at,
                withdrawnByName: row.withdrawn_by,
                replacedById: row.replaced_by,
              } satisfies HandoverRef);
        },

        async insertHandover(handover) {
          // released_at is the database's clock: the moment it was recorded.
          await db.query(sql`
            INSERT INTO handover (id, visit_id, portal_client_id, released_by, portal_purchase_id, gate_answer, gate_request_id,
                                  note, replaces_handover_id)
            VALUES (${handover.id}, ${handover.visitId}::uuid, ${handover.clientId}::uuid, ${handover.releasedBy},
                    ${handover.purchaseId}, ${handover.gateAnswer}, ${handover.gateRequestId}, ${handover.note}, ${handover.replacesId}::uuid)`);
          for (const item of handover.items) {
            await db.query(sql`
              INSERT INTO handover_item (handover_id, document_type_code, quantity)
              VALUES (${handover.id}, ${item.code}, ${item.quantity})`);
          }
        },

        async insertCorrection({ id, handoverId, reason, correctedBy }) {
          await db.query(sql`
            INSERT INTO handover_correction (id, handover_id, reason, corrected_by)
            VALUES (${id}, ${handoverId}::uuid, ${reason}, ${correctedBy})`);
        },

        async audit({ actorId, entity, entityId, after }) {
          await db.query(sql`
            INSERT INTO audit_log (actor_staff_id, entity, entity_id, action, before, after)
            VALUES (${actorId}, ${entity}, ${entityId}, ${"CREATE"}, NULL, ${JSON.stringify(after)}::jsonb)`);
        },
      };
      return work(tx);
    });
  },
};
