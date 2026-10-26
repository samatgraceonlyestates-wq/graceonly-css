// DOCUMENT HANDOVERS: recording what was physically handed to a client on a visit, what the
// portal said about it, and correcting a record by APPENDING (migration 018). The rules live
// here; the database is reached only through HandoverStore (handoverStore.ts) and the portal
// only through the injected releaseCheck (portal.ts in the app, a stub in the tests). Imports
// nothing but TYPES from portal.ts, so the screen can share the lists and labels.
//
// SILENCE IS NOT PERMISSION. The release decision is the PORTAL's (CLAUDE.md, Decisions): CSS
// records what the portal said and never overrides it. Today the gate is OFF (release-check
// answers 409 GATE_NOT_ACTIVE). An off gate, a portal that cannot be reached, an answer about
// someone else, or an answer that does not mention a document is NEVER read as "allowed".
//
// THE GATE ANSWER is a SNAPSHOT taken by THIS call, at the moment the handover is recorded
// (release-check is asked again on every save; nothing from the page load is reused), and it is
// stored as it came, never guessed and never defaulted:
//   CHECKED_ALLOWED  the gate is on, and every gated document chosen is allowed for the purchase
//   NOT_GATED        the gate is on, and none of the documents chosen is a gated type
//   CHECKED_BLOCKED  the gate is on, and the portal refused at least one document chosen (or the
//                    purchase or a document is not in its answer). NOTHING IS RECORDED: the desk
//                    is stopped, not warned, whatever she confirms.
//   GATE_OFF         409 GATE_NOT_ACTIVE: nobody verified the release
//   UNAVAILABLE      the check could not be made (network, timeout, 429, 503, 401, a malformed
//                    or someone else's answer): nobody verified the release
// GATE_OFF and UNAVAILABLE are RECORDED (the documents left either way, and refusing to record a
// release does not undo it) but only after the desk confirms, in so many words, a release nobody
// verified; the record says so wherever it is shown.
//
// A NON-CLIENT CANNOT RECEIVE DOCUMENTS: a visit with no portal client is refused before the
// portal is asked (and the database refuses it too: handover_visit_is_client_fkey).
//
// CORRECTIONS APPEND (018). A wrong record is WITHDRAWN by a handover_correction row (reason,
// who, when); the original stays and is always shown with it. If the release did happen but
// was recorded wrongly, the right one is recorded as a NEW handover that names the withdrawn one
// (replaces_handover_id) and runs release-check again: a correction never carries an old gate
// answer onto different documents.
import type { PortalResult, ReleaseCheck, ReleaseReasonInAnswer } from "./portal.ts";

// Legal hands documents over (PRD 6.2); the front desk records them; the owner is ADMIN.
export const HANDOVER_ROLES = ["FRONT_DESK", "LEGAL", "ADMIN"] as const;

/**
 * The portal's six document slots, in its order, with its labels (portal.ts DOCUMENT_TYPES and
 * DOCUMENT_LABELS; the document_type rows of 007 carry the same). Authoritative: no label here
 * is ours. OTHER (an unattached document) is not offered: release-check cannot be asked about it.
 */
export const HANDOVER_DOCUMENTS = [
  { code: "DEED_OF_ASSIGNMENT", label: "Deed of Assignment" },
  { code: "SURVEY_PLAN", label: "Provisional Survey Plan" },
  { code: "RECEIPT", label: "Receipt of Payment" },
  { code: "CONTRACT_OF_SALE", label: "Purchase Agreement" },
  { code: "ACKNOWLEDGMENT_LETTER", label: "Initial Allocation Letter" },
  { code: "CERTIFICATE_OF_OCCUPANCY", label: "C of O Copy" },
] as const;
export type HandoverDocumentCode = (typeof HANDOVER_DOCUMENTS)[number]["code"];

export const documentLabel = (code: string) => HANDOVER_DOCUMENTS.find((document) => document.code === code)?.label ?? code;

export const GATE_ANSWERS = ["CHECKED_ALLOWED", "CHECKED_BLOCKED", "GATE_OFF", "UNAVAILABLE", "NOT_GATED"] as const;
export type GateAnswer = (typeof GATE_ANSWERS)[number];

/** How every screen says what the portal said. `verified` is true only when the portal actually answered. */
export const GATE_ANSWER_TEXT: Record<GateAnswer, { pill: string; tone: "green" | "steel" | "amber" | "red"; detail: string; verified: boolean }> = {
  CHECKED_ALLOWED: { pill: "Portal allowed", tone: "green", detail: "The portal's release-check allowed these documents.", verified: true },
  NOT_GATED: { pill: "Not gated", tone: "steel", detail: "The portal answered: none of these documents is gated.", verified: true },
  CHECKED_BLOCKED: { pill: "Portal refused", tone: "red", detail: "The portal's release-check refused these documents.", verified: true },
  GATE_OFF: {
    pill: "Not verified",
    tone: "amber",
    detail: "NOBODY VERIFIED THIS RELEASE: the portal's document gate was off, so it could not say whether it was allowed.",
    verified: false,
  },
  UNAVAILABLE: {
    pill: "Not verified",
    tone: "amber",
    detail: "NOBODY VERIFIED THIS RELEASE: the portal could not be asked when it was recorded.",
    verified: false,
  },
};

export const RELEASE_REASON_TEXT: Record<ReleaseReasonInAnswer, string> = {
  NO_FEE: "No documentation fee on this purchase",
  PAID: "Documentation fee paid",
  OUTSTANDING: "Documentation fee outstanding",
  UNKNOWN: "Documentation fee position unknown",
  INVALID_TERMS: "Fee terms on record are invalid",
  ENDED: "Purchase has ended",
  NOT_GATED_TYPE: "Not a gated document",
};

export const HANDOVER_LIMITS = Object.freeze({ maxQuantity: 20, maxNoteLength: 500, maxReasonLength: 500, maxPurchaseIdLength: 100 });

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (value: unknown): value is string => typeof value === "string" && UUID.test(value);

// ---------------------------------------------------------------------------------------
// What the portal said, for these documents on this purchase. Pure.
// ---------------------------------------------------------------------------------------

export interface Refusal {
  code: string;
  label: string;
  why: string;
}

export type Judgement =
  | { kind: "answer"; answer: GateAnswer; requestId: string | null; refused: Refusal[] }
  /** The gate is on and the portal answered, but no purchase was chosen: it cannot be judged. */
  | { kind: "needs_purchase" };

export function judgeRelease(
  result: PortalResult<ReleaseCheck>,
  ask: { clientId: string; purchaseId: string | null; documents: readonly string[] },
): Judgement {
  const answer = (value: GateAnswer, requestId: string | null, refused: Refusal[] = []): Judgement => ({ kind: "answer", answer: value, requestId, refused });

  // Could not ask, or the answer is not one: UNAVAILABLE. Never "allowed".
  if (!result.ok) return answer("UNAVAILABLE", result.error.requestId);
  if (result.data.gate === "not_active") return answer("GATE_OFF", result.requestId);
  const check = result.data.answer;
  if (check.clientId.toLowerCase() !== ask.clientId.toLowerCase()) return answer("UNAVAILABLE", result.requestId);
  if (ask.purchaseId === null) return { kind: "needs_purchase" };

  const purchase = check.purchases.find((candidate) => candidate.purchaseId === ask.purchaseId);
  if (purchase === undefined) {
    // Not in the answer (ended, someone else's, unknown): the portal did not allow it.
    return answer(
      "CHECKED_BLOCKED",
      result.requestId,
      ask.documents.map((code) => ({ code, label: documentLabel(code), why: "The portal's answer does not include this purchase" })),
    );
  }

  const refused: Refusal[] = [];
  let gated = 0;
  for (const code of ask.documents) {
    const entry = purchase.byType.find((candidate) => candidate.documentType === code);
    if (entry === undefined) {
      refused.push({ code, label: documentLabel(code), why: "The portal's answer does not mention this document" });
      continue;
    }
    if (!entry.typeIsGated) continue;
    gated += 1;
    if (!entry.allowed) refused.push({ code, label: documentLabel(code), why: RELEASE_REASON_TEXT[entry.reason] });
  }
  if (refused.length > 0) return answer("CHECKED_BLOCKED", result.requestId, refused);
  return answer(gated === 0 ? "NOT_GATED" : "CHECKED_ALLOWED", result.requestId);
}

// ---------------------------------------------------------------------------------------
// The store
// ---------------------------------------------------------------------------------------

export interface HandoverVisit {
  id: string;
  name: string;
  /** The portal client of the visit, or null for a non-client. */
  clientId: string | null;
  voidedAt: Date | null;
}

export interface HandoverRef {
  id: string;
  visitId: string;
  releasedAt: Date;
  withdrawnAt: Date | null;
  withdrawnByName: string | null;
  /** The handover recorded to replace this one, if any. */
  replacedById: string | null;
}

export interface NewHandover {
  id: string;
  visitId: string;
  clientId: string;
  releasedBy: string;
  purchaseId: string | null;
  gateAnswer: GateAnswer;
  gateRequestId: string | null;
  note: string | null;
  replacesId: string | null;
  items: { code: HandoverDocumentCode; quantity: number }[];
}

export interface HandoverAudit {
  actorId: string;
  entity: "handover" | "handover_correction";
  entityId: string;
  after: Record<string, unknown>;
}

export interface HandoverTx {
  /** The visit row, FOR UPDATE: a visit cannot be removed while a handover is written to it. */
  lockVisit(visitId: string): Promise<void>;
  findVisit(visitId: string): Promise<HandoverVisit | null>;
  lockHandover(id: string): Promise<void>;
  findHandover(id: string): Promise<HandoverRef | null>;
  insertHandover(handover: NewHandover): Promise<void>;
  insertCorrection(correction: { id: string; handoverId: string; reason: string; correctedBy: string }): Promise<void>;
  audit(entry: HandoverAudit): Promise<void>;
}

export interface HandoverStore {
  /** Read without a transaction: the portal is asked before one is opened, so no lock is held across it. */
  visit(visitId: string): Promise<HandoverVisit | null>;
  transaction<T>(work: (tx: HandoverTx) => Promise<T>): Promise<T>;
}

export interface HandoverDeps {
  store: HandoverStore;
  actorId: string;
  newId: () => string;
  /** The portal's release-check for one client (getReleaseCheck in the app). */
  releaseCheck: (clientId: string) => Promise<PortalResult<ReleaseCheck>>;
}

// ---------------------------------------------------------------------------------------
// Recording a handover
// ---------------------------------------------------------------------------------------

export interface RecordHandoverInput {
  visitId: string;
  /** "" for none. */
  purchaseId: string;
  /** Document code -> quantity as typed ("" or "0" for none). */
  quantities: Record<string, string>;
  note: string;
  /** She has confirmed recording a release nobody verified (gate off, or the portal unavailable). */
  acknowledgeUnverified: boolean;
  /** The withdrawn handover this one replaces, or "". */
  replacesHandoverId: string;
}

export type RecordHandoverResult =
  | { ok: true; handoverId: string; answer: GateAnswer; message: string }
  | { ok: false; kind: "refused"; message: string }
  /** The portal refused: NOTHING was recorded, and confirming changes nothing. */
  | { ok: false; kind: "blocked"; message: string; refused: Refusal[] }
  /** Nobody can verify it: NOTHING was recorded yet; she may confirm and record it as unverified. */
  | { ok: false; kind: "unverified"; answer: "GATE_OFF" | "UNAVAILABLE"; message: string };

export const HANDOVER_MESSAGES = Object.freeze({
  stale: "That visit has changed. Reload the page and look again.",
  nothingChosen: "Choose what was handed over: at least one document, with how many.",
  nonClient:
    "Documents can only be handed over to a client picked from the portal at check-in. This visit is not a client's, so nothing can be recorded against it.",
  removed: "This visit has been removed. Restore it first, or record the handover on the right visit.",
  needsPurchase: "Choose which purchase the documents belong to.",
  needsReason: "A correction needs a reason: say what was wrong, for example two copies were handed over, not one.",
});

const refuse = (message: string): RecordHandoverResult => ({ ok: false, kind: "refused", message });

/** The chosen documents and quantities, checked. */
export function parseQuantities(raw: Record<string, string>): { ok: true; items: NewHandover["items"] } | { ok: false; message: string } {
  const items: NewHandover["items"] = [];
  for (const document of HANDOVER_DOCUMENTS) {
    const typed = (raw[document.code] ?? "").trim();
    if (typed === "" || typed === "0") continue;
    if (!/^\d{1,3}$/.test(typed)) return { ok: false, message: `Type how many ${document.label} as a whole number.` };
    const quantity = Number(typed);
    if (quantity > HANDOVER_LIMITS.maxQuantity) return { ok: false, message: `At most ${HANDOVER_LIMITS.maxQuantity} of one document in a handover.` };
    items.push({ code: document.code, quantity });
  }
  const unknown = Object.keys(raw).filter((code) => !HANDOVER_DOCUMENTS.some((document) => document.code === code));
  if (unknown.length > 0) return { ok: false, message: "That document type is not one the portal knows. Reload the page." };
  return items.length === 0 ? { ok: false, message: HANDOVER_MESSAGES.nothingChosen } : { ok: true, items };
}

export async function recordHandover(input: RecordHandoverInput, deps: HandoverDeps): Promise<RecordHandoverResult> {
  if (!isUuid(input.visitId)) return refuse(HANDOVER_MESSAGES.stale);
  const parsed = parseQuantities(input.quantities);
  if (!parsed.ok) return refuse(parsed.message);
  const note = typeof input.note === "string" ? input.note.replace(/\s+/g, " ").trim() : "";
  if (note.length > HANDOVER_LIMITS.maxNoteLength) return refuse(`Keep the note under ${HANDOVER_LIMITS.maxNoteLength} characters.`);
  const purchaseId = typeof input.purchaseId === "string" && input.purchaseId.trim() !== "" ? input.purchaseId.trim() : null;
  if (purchaseId !== null && (purchaseId.length > HANDOVER_LIMITS.maxPurchaseIdLength || !/^[\x21-\x7e]+$/.test(purchaseId))) {
    return refuse("That purchase could not be read. Reload the page.");
  }
  const replacesId = isUuid(input.replacesHandoverId) ? input.replacesHandoverId : null;

  // 1. The visit: a client's, and not removed. A non-client is refused BEFORE the portal is asked.
  const visit = await deps.store.visit(input.visitId);
  if (visit === null) return refuse(HANDOVER_MESSAGES.stale);
  if (visit.clientId === null) return refuse(HANDOVER_MESSAGES.nonClient);
  if (visit.voidedAt !== null) return refuse(HANDOVER_MESSAGES.removed);

  // 2. The portal, NOW. Its answer is the snapshot stored; nothing from earlier is reused.
  const codes = parsed.items.map((item) => item.code);
  const judged = judgeRelease(await deps.releaseCheck(visit.clientId), { clientId: visit.clientId, purchaseId, documents: codes });
  if (judged.kind === "needs_purchase") return refuse(HANDOVER_MESSAGES.needsPurchase);

  // 3. Refused by the portal: STOPPED. Nothing is recorded, whatever she confirmed.
  if (judged.answer === "CHECKED_BLOCKED") {
    return {
      ok: false,
      kind: "blocked",
      refused: judged.refused,
      message: "The portal refused this release, so it was NOT recorded. Do not hand these documents over.",
    };
  }

  // 4. Nobody can verify it: asked first, recorded only once she says so.
  if ((judged.answer === "GATE_OFF" || judged.answer === "UNAVAILABLE") && input.acknowledgeUnverified !== true) {
    return {
      ok: false,
      kind: "unverified",
      answer: judged.answer,
      message:
        judged.answer === "GATE_OFF"
          ? "The portal's document gate is off, so NOBODY can verify this release. Silence is not permission. If the documents have already been handed over, record it: it will be marked as not verified."
          : "The portal could not be asked, so NOBODY can verify this release. If the documents have already been handed over, record it: it will be marked as not verified.",
    };
  }

  // 5. Written under the visit's lock, checked again.
  return deps.store.transaction(async (tx): Promise<RecordHandoverResult> => {
    await tx.lockVisit(visit.id);
    const now = await tx.findVisit(visit.id);
    if (now === null || now.clientId === null) return refuse(HANDOVER_MESSAGES.stale);
    if (now.voidedAt !== null) return refuse(HANDOVER_MESSAGES.removed);

    if (replacesId !== null) {
      await tx.lockHandover(replacesId);
      const old = await tx.findHandover(replacesId);
      if (old === null || old.visitId !== visit.id) return refuse("The record being replaced is not on this visit. Reload the page.");
      if (old.withdrawnAt === null) return refuse("Withdraw the wrong record first, with a reason, then record the right one.");
      if (old.replacedById !== null) return refuse("That record has already been replaced. Reload the page.");
    }

    const handoverId = deps.newId();
    await tx.insertHandover({
      id: handoverId,
      visitId: visit.id,
      clientId: now.clientId,
      releasedBy: deps.actorId,
      purchaseId,
      gateAnswer: judged.answer,
      gateRequestId: judged.requestId,
      note: note || null,
      replacesId,
      items: parsed.items,
    });
    // Codes, quantities and the answer only: no client data (006).
    await tx.audit({
      actorId: deps.actorId,
      entity: "handover",
      entityId: handoverId,
      after: { visit_id: visit.id, gate_answer: judged.answer, items: parsed.items, replaces: replacesId, via: "handover" },
    });
    const text = GATE_ANSWER_TEXT[judged.answer];
    return {
      ok: true,
      handoverId,
      answer: judged.answer,
      message: text.verified ? `Recorded. ${text.detail}` : `Recorded as NOT VERIFIED. ${text.detail}`,
    };
  });
}

// ---------------------------------------------------------------------------------------
// Correcting: withdrawing a record, by appending
// ---------------------------------------------------------------------------------------

export type WithdrawResult = { ok: true; message: string } | { ok: false; message: string };

export async function withdrawHandover(input: { handoverId: string; reason: string }, deps: Omit<HandoverDeps, "releaseCheck">): Promise<WithdrawResult> {
  const reason = typeof input.reason === "string" ? input.reason.trim() : "";
  if (reason === "") return { ok: false, message: HANDOVER_MESSAGES.needsReason };
  if (reason.length > HANDOVER_LIMITS.maxReasonLength) return { ok: false, message: `Keep the reason under ${HANDOVER_LIMITS.maxReasonLength} characters.` };
  if (!isUuid(input.handoverId)) return { ok: false, message: HANDOVER_MESSAGES.stale };

  return deps.store.transaction(async (tx): Promise<WithdrawResult> => {
    await tx.lockHandover(input.handoverId);
    const handover = await tx.findHandover(input.handoverId);
    if (handover === null) return { ok: false, message: HANDOVER_MESSAGES.stale };
    if (handover.withdrawnAt !== null) {
      return { ok: false, message: `That record was already withdrawn${handover.withdrawnByName ? ` by ${handover.withdrawnByName}` : ""}. Reload the page.` };
    }
    const id = deps.newId();
    await tx.insertCorrection({ id, handoverId: handover.id, reason, correctedBy: deps.actorId });
    await tx.audit({
      actorId: deps.actorId,
      entity: "handover_correction",
      entityId: id,
      after: { handover_id: handover.id, correction_reason: reason, via: "correction" },
    });
    return { ok: true, message: "The record was withdrawn. It stays on the visit, marked with your reason. If the handover did happen, record the right one." };
  });
}

// ---------------------------------------------------------------------------------------
// The list: every record WITH its correction. Pure.
// ---------------------------------------------------------------------------------------

export interface HandoverRow {
  id: string;
  releasedAt: Date;
  releasedByName: string | null;
  purchaseId: string | null;
  gateAnswer: GateAnswer;
  gateRequestId: string | null;
  note: string | null;
  replacesId: string | null;
}

export interface HandoverCorrectionRow {
  handoverId: string;
  reason: string;
  correctedAt: Date;
  correctedByName: string | null;
}

export interface HandoverView extends HandoverRow {
  items: { code: string; label: string; quantity: number }[];
  /** Its correction, if it has one. A withdrawn record is never listed without it. */
  correction: HandoverCorrectionRow | null;
  /** The record that replaced it, and the one it replaces. */
  replacedBy: { id: string; releasedAt: Date } | null;
  replaces: { id: string; releasedAt: Date; reason: string | null } | null;
}

export function assembleHandovers(
  rows: readonly HandoverRow[],
  items: readonly { handoverId: string; code: string; quantity: number }[],
  corrections: readonly HandoverCorrectionRow[],
): HandoverView[] {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const correctionOf = new Map(corrections.map((correction) => [correction.handoverId, correction]));
  return [...rows]
    .sort((a, b) => a.releasedAt.getTime() - b.releasedAt.getTime())
    .map((row) => {
      const replacing = row.replacesId !== null ? byId.get(row.replacesId) : undefined;
      const replacer = rows.find((candidate) => candidate.replacesId === row.id);
      return {
        ...row,
        items: items
          .filter((item) => item.handoverId === row.id)
          .sort((a, b) => HANDOVER_DOCUMENTS.findIndex((d) => d.code === a.code) - HANDOVER_DOCUMENTS.findIndex((d) => d.code === b.code))
          .map((item) => ({ code: item.code, label: documentLabel(item.code), quantity: item.quantity })),
        correction: correctionOf.get(row.id) ?? null,
        replacedBy: replacer ? { id: replacer.id, releasedAt: replacer.releasedAt } : null,
        replaces: replacing ? { id: replacing.id, releasedAt: replacing.releasedAt, reason: correctionOf.get(replacing.id)?.reason ?? null } : null,
      };
    });
}
