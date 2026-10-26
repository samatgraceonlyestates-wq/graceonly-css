// THE VISITOR LOG: checking a visitor in, checking them out, closing the day, and
// correcting a visit. The rules live here; the database is reached only through VisitStore
// (visitStore.ts is the PostgreSQL one, the tests use an in-memory one). Imports nothing
// from Next, `pg` or the browser, so the form can share its lists and limits.
//
// CHECK IN (screen 04). One visit row, the reason, who they came to see, and who typed it
// (checked_in_by: the signed-in user). The time is the database's clock.
//  * A CLIENT the desk picked from the portal's list is stored as portal_client_id and
//    client_name_logged: the name AS THE PORTAL GAVE IT at the desk, a snapshot that is
//    never refreshed (003). lookup_outcome MATCHED.
//  * Anyone else gets a VISITOR row: their name, phone (normalised to E.164, optional),
//    organisation (optional), and consent_at. Consent is REQUIRED: without it nothing about
//    them may be recorded, so check-in is refused and the form says so.
//  * lookup_outcome is HONEST and consistent with the type:
//      NOT_LOOKED_UP       any type but Client: no search is made
//      NO_MATCH            a Client the portal searched for and nobody was chosen
//      PORTAL_UNAVAILABLE  a Client whose search FAILED: the desk went on without the
//                          portal (check-in must never depend on it being up)
//      MATCHED             a Client picked from the portal's list
//    A Client cannot be NOT_LOOKED_UP: the form must have tried the portal first. The
//    outcome is what the form saw (the server cannot see the desk's screen); this file
//    refuses every combination that cannot be true.
//  * ONE OPEN VISIT PER PERSON: a client (by portal id) or a visitor (by visitor row) who is
//    already checked in is refused, naming the open visit. Checked under a lock on that
//    identity; the unique indexes of 017 are the backstop.
//  * A REPEAT VISITOR is found by PHONE only, and only when the desk CONFIRMS it: a number
//    already on file asks "is this <name>?" and nothing is written until she answers. Never
//    an automatic merge (003). No phone, no match: a new visitor row.
//
// CHECK OUT. Closes an open visit NOW (the database's clock), as NORMAL, recording who did
// it. A stale click (someone else closed it, or removed it) is a clear message, never a
// second write.
//
// CLOSE THE DAY. AUTO_CLOSED is never set by itself: the desk presses a button that lists
// the visits still open and confirms. checked_out_by records who closed them; checked_out_at
// is when they were CLOSED, not when the visitor left, which nobody recorded, so every
// screen shows such a visit's length as UNKNOWN, never as a duration.
//
// CORRECT. The same discipline as attendance (corrections.ts): every correction needs a
// REASON (checked first, before anything is read), records who and when (corrected_at,
// corrected_by, correction_reason: the LATEST one) and writes an audit row; the visit is
// locked and the VERSION she was looking at must still be current. Removing is a VOID, not a
// delete, and can be undone (restore), unless that would make a second open visit.
import { parseClockTime } from "./clockTime.ts";
import { timeLabel } from "./departureTime.ts";
import { formatIsoDate } from "./format.ts";
import { lagosDateOf, lagosInstantAt } from "./lagosTime.ts";
import { normalisePhone } from "./phoneNumber.ts";
import { cleanDisplayName } from "./rosterMatch.ts";

export const VISIT_ROLES = ["FRONT_DESK", "ADMIN"] as const;

/** Mirrors the rows seeded by migration 001 (visitor_type); the foreign key is the final word. */
export const VISITOR_TYPES = [
  { code: "CLIENT", label: "Client" },
  { code: "REALTOR", label: "Realtor" },
  { code: "INVESTOR", label: "Investor" },
  { code: "DELIVERY", label: "Delivery" },
  { code: "VISITOR", label: "Visitor" },
] as const;
export type VisitorTypeCode = (typeof VISITOR_TYPES)[number]["code"];

/** Mirrors visit_reason (001). */
export const VISIT_REASONS = [
  { code: "INQUIRY", label: "Inquiry" },
  { code: "COMPLAINT", label: "Complaint" },
  { code: "DOCUMENT_COLLECTION", label: "Document collection" },
  { code: "CONTRACT_SIGNING", label: "Contract signing" },
  { code: "SCHEDULED_MEETING", label: "Scheduled meeting" },
] as const;
export type VisitReasonCode = (typeof VISIT_REASONS)[number]["code"];

export const LOOKUP_OUTCOMES = ["MATCHED", "NO_MATCH", "NOT_LOOKED_UP", "PORTAL_UNAVAILABLE"] as const;
export type LookupOutcome = (typeof LOOKUP_OUTCOMES)[number];

export type CloseReason = "NORMAL" | "NO_SHOW" | "AUTO_CLOSED";

export const VISIT_LIMITS = Object.freeze({
  maxNameLength: 100,
  maxClientNameLength: 200,
  maxOrganisationLength: 100,
  maxToSeeLength: 100,
  maxReasonLength: 500,
  maxCloseAtOnce: 200,
});

/** The portal's client ids are UUIDs (visit.portal_client_id is uuid). */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (value: unknown): value is string => typeof value === "string" && UUID.test(value);

export const typeLabel = (code: string) => VISITOR_TYPES.find((type) => type.code === code)?.label ?? code;
export const reasonLabel = (code: string) => VISIT_REASONS.find((reason) => reason.code === code)?.label ?? code;

/** How the screens say what the lookup came to. */
export const LOOKUP_TEXT: Record<LookupOutcome, string> = {
  MATCHED: "Client, picked from the portal's records",
  NO_MATCH: "Said they were a client; the portal found nobody, so logged as a non-client",
  NOT_LOOKED_UP: "Not a client: no lookup made",
  PORTAL_UNAVAILABLE: "Said they were a client; NOT VERIFIED: the portal could not be reached at check-in",
};

// ---------------------------------------------------------------------------------------
// The store
// ---------------------------------------------------------------------------------------

/** One visit as the rules need it. */
export interface VisitRecord {
  id: string;
  /** updated_at as text, to the microsecond. */
  version: string;
  /** client_name_logged for a client, the visitor's name otherwise. */
  name: string;
  clientId: string | null;
  visitorId: string | null;
  visitorTypeCode: string;
  reasonCode: string;
  toSee: string | null;
  lookupOutcome: LookupOutcome;
  checkedInAt: Date;
  checkedOutAt: Date | null;
  closeReason: CloseReason | null;
  checkedOutByName: string | null;
  voidedAt: Date | null;
  /** The visitor's phone (E.164), for a non-client. */
  phone: string | null;
  /** When ANOTHER live open visit of the same person started, if there is one. */
  otherOpenSince: Date | null;
  /** Document handovers recorded on this visit and not withdrawn (018). */
  liveHandovers: number;
}

export interface OpenVisit {
  id: string;
  checkedInAt: Date;
  checkedInByName: string | null;
}

export interface KnownVisitor {
  id: string;
  name: string;
  lastVisitAt: Date | null;
}

export interface NewVisitor {
  id: string;
  displayName: string;
  phone: string | null;
  organisation: string | null;
  createdBy: string;
}

export interface NewVisit {
  id: string;
  visitorTypeCode: VisitorTypeCode;
  reasonCode: VisitReasonCode;
  clientId: string | null;
  clientNameLogged: string | null;
  visitorId: string | null;
  lookupOutcome: LookupOutcome;
  toSee: string | null;
  checkedInBy: string;
}

export type VisitCorrection =
  | { kind: "checkin"; checkedInAt: Date }
  | { kind: "checkout"; checkedOutAt: Date }
  | { kind: "reopen" }
  | { kind: "reason"; reasonCode: VisitReasonCode }
  | { kind: "toSee"; toSee: string | null }
  | { kind: "type"; visitorTypeCode: VisitorTypeCode }
  | { kind: "name"; visitorId: string; displayName: string }
  | { kind: "phone"; visitorId: string; phone: string | null }
  | { kind: "void" }
  | { kind: "restore" };

export interface AuditEntry {
  actorId: string;
  entity: "visit" | "visitor";
  entityId: string;
  action: "CREATE" | "UPDATE";
  before: Record<string, unknown> | null;
  after: Record<string, unknown>;
}

export interface VisitTx {
  /** Serialises everything about ONE person (a client id, a visitor id, a phone number) for the transaction. */
  lockIdentity(key: string): Promise<void>;
  /** Locks the visit's person (lockIdentity) and then the visit row, in that order. */
  lockVisit(visitId: string): Promise<void>;
  findVisit(visitId: string): Promise<VisitRecord | null>;
  /** The live open visit of this client or visitor, if any. */
  openVisitOf(identity: { clientId: string } | { visitorId: string }): Promise<OpenVisit | null>;
  /** The live (not merged) visitor with this number, other than `exceptVisitorId`. */
  visitorByPhone(phone: string, exceptVisitorId?: string | null): Promise<KnownVisitor | null>;
  insertVisitor(visitor: NewVisitor): Promise<void>;
  insertVisit(visit: NewVisit): Promise<void>;
  /** Guarded: only if still open and not removed. False if nothing was updated. */
  checkOut(input: { id: string; actorId: string }): Promise<boolean>;
  /** Guarded like checkOut. Returns when it was closed, or null if nothing was updated. */
  autoClose(input: { id: string; actorId: string }): Promise<Date | null>;
  /** Guarded by the version AND the state the rule checked. False if nothing was updated. */
  applyCorrection(input: { id: string; version: string; actorId: string; reason: string; correction: VisitCorrection }): Promise<boolean>;
  audit(entry: AuditEntry): Promise<void>;
}

export interface VisitStore {
  transaction<T>(work: (tx: VisitTx) => Promise<T>): Promise<T>;
}

export interface VisitDeps {
  store: VisitStore;
  actorId: string;
  now: Date;
  newId: () => string;
}

export const identityKey = (identity: { clientId: string } | { visitorId: string }) =>
  "clientId" in identity ? `visit-client:${identity.clientId.toLowerCase()}` : `visit-visitor:${identity.visitorId}`;
export const phoneKey = (phone: string) => `visitor-phone:${phone}`;

// ---------------------------------------------------------------------------------------
// Check in
// ---------------------------------------------------------------------------------------

export interface CheckInInput {
  visitorType: string;
  reason: string;
  toSee: string;
  /** What the form's lookup came to (see the outcomes above). */
  lookup: string;
  /** MATCHED only: the picked client, and their name as the portal gave it. */
  clientId: string;
  clientName: string;
  /** Everyone else. */
  name: string;
  phone: string;
  organisation: string;
  consent: boolean;
  /** The visitor the desk confirmed as this person, after their number matched. */
  sameVisitorId: string;
}

export type CheckInPlan =
  | {
      kind: "client";
      visitorTypeCode: "CLIENT";
      reasonCode: VisitReasonCode;
      toSee: string | null;
      clientId: string;
      clientName: string;
    }
  | {
      kind: "visitor";
      visitorTypeCode: VisitorTypeCode;
      reasonCode: VisitReasonCode;
      toSee: string | null;
      lookupOutcome: Exclude<LookupOutcome, "MATCHED">;
      name: string;
      phone: string | null;
      organisation: string | null;
      sameVisitorId: string | null;
    };

export type CheckInProblem = { ok: false; message: string; field: "type" | "reason" | "lookup" | "name" | "phone" | "organisation" | "consent" | "toSee" | null };

export const MESSAGES = Object.freeze({
  type: "Choose who is visiting.",
  reason: "Choose a reason for the visit.",
  lookupFirst: "Look the client up first. If the portal cannot be reached, check them in without it: the visit is marked as not verified.",
  lookupGone: "That lookup could not be used. Look them up again.",
  name: "Type the visitor's name.",
  consent: "Ask whether they agree to their name and number being recorded. CSS cannot record them without it: write them in the paper book instead.",
  stale: "That visit has changed. Reload the page and look again.",
  needsReason: "A correction needs a reason: say what was wrong, for example the reason was Inquiry.",
  staleVersion: "This visit was changed by someone else while you were looking at it. Nothing was changed. Close this and open it again to see the latest.",
});

const fail = (message: string, field: CheckInProblem["field"] = null): CheckInProblem => ({ ok: false, message, field });

/** Collapses runs of space and trims. "" means none. */
const tidy = (raw: unknown) => (typeof raw === "string" ? raw.replace(/\s+/g, " ").trim() : "");

/** The form's input, checked and shaped. Pure: nothing is read or written. */
export function planCheckIn(input: CheckInInput): { ok: true; plan: CheckInPlan } | CheckInProblem {
  const type = VISITOR_TYPES.find((candidate) => candidate.code === input.visitorType);
  if (type === undefined) return fail(MESSAGES.type, "type");
  const reason = VISIT_REASONS.find((candidate) => candidate.code === input.reason);
  if (reason === undefined) return fail(MESSAGES.reason, "reason");
  const lookup = LOOKUP_OUTCOMES.find((candidate) => candidate === input.lookup);
  if (lookup === undefined) return fail(MESSAGES.lookupGone, "lookup");

  const toSee = tidy(input.toSee);
  if (toSee.length > VISIT_LIMITS.maxToSeeLength) return fail(`Keep who they came to see under ${VISIT_LIMITS.maxToSeeLength} characters.`, "toSee");

  // Only a Client is looked up, and a Client must have been.
  if (type.code === "CLIENT" && lookup === "NOT_LOOKED_UP") return fail(MESSAGES.lookupFirst, "lookup");
  if (type.code !== "CLIENT" && lookup !== "NOT_LOOKED_UP") return fail(MESSAGES.lookupGone, "lookup");

  if (lookup === "MATCHED") {
    const clientName = tidy(input.clientName);
    if (!isUuid(input.clientId) || clientName === "" || clientName.length > VISIT_LIMITS.maxClientNameLength) {
      return fail(MESSAGES.lookupGone, "lookup");
    }
    return {
      ok: true,
      plan: { kind: "client", visitorTypeCode: "CLIENT", reasonCode: reason.code, toSee: toSee || null, clientId: input.clientId.toLowerCase(), clientName },
    };
  }

  const name = cleanDisplayName(typeof input.name === "string" ? input.name : "");
  if (name === "") return fail(MESSAGES.name, "name");
  if (name.length > VISIT_LIMITS.maxNameLength) return fail(`Keep the name under ${VISIT_LIMITS.maxNameLength} characters.`, "name");
  const phone = normalisePhone(input.phone);
  if (phone.kind === "invalid") return fail(phone.message, "phone");
  const organisation = tidy(input.organisation);
  if (organisation.length > VISIT_LIMITS.maxOrganisationLength) {
    return fail(`Keep the organisation under ${VISIT_LIMITS.maxOrganisationLength} characters.`, "organisation");
  }
  if (input.consent !== true) return fail(MESSAGES.consent, "consent");

  return {
    ok: true,
    plan: {
      kind: "visitor",
      visitorTypeCode: type.code,
      reasonCode: reason.code,
      toSee: toSee || null,
      lookupOutcome: lookup,
      name,
      phone: phone.kind === "ok" ? phone.e164 : null,
      organisation: organisation || null,
      sameVisitorId: isUuid(input.sameVisitorId) ? input.sameVisitorId : null,
    },
  };
}

export type CheckInResult =
  | { ok: true; visitId: string; name: string }
  | { ok: false; kind: "refused"; message: string; field: CheckInProblem["field"] }
  /** Their number is on file for someone: nothing was written until the desk says whether it is them. */
  | { ok: false; kind: "confirm_visitor"; message: string; visitor: KnownVisitor };

/** "since 10:12" today, "since 10:12 on 21 Oct 2026" on an earlier day. */
function since(at: Date, now: Date): string {
  const day = lagosDateOf(at);
  return day === lagosDateOf(now) ? `since ${timeLabel(at)}` : `since ${timeLabel(at)} on ${formatIsoDate(day)}`;
}

function alreadyIn(name: string, open: OpenVisit, now: Date): string {
  const by = open.checkedInByName ? `, checked in by ${open.checkedInByName}` : "";
  return `${name} is already checked in ${since(open.checkedInAt, now)}${by}. Check that visit out first.`;
}

export async function checkIn(input: CheckInInput, deps: VisitDeps): Promise<CheckInResult> {
  const planned = planCheckIn(input);
  if (!planned.ok) return { ok: false, kind: "refused", message: planned.message, field: planned.field };
  const plan = planned.plan;

  return deps.store.transaction(async (tx): Promise<CheckInResult> => {
    const visitId = deps.newId();

    if (plan.kind === "client") {
      await tx.lockIdentity(identityKey({ clientId: plan.clientId }));
      const open = await tx.openVisitOf({ clientId: plan.clientId });
      if (open !== null) return { ok: false, kind: "refused", message: alreadyIn(plan.clientName, open, deps.now), field: null };
      await tx.insertVisit({
        id: visitId,
        visitorTypeCode: "CLIENT",
        reasonCode: plan.reasonCode,
        clientId: plan.clientId,
        clientNameLogged: plan.clientName,
        visitorId: null,
        lookupOutcome: "MATCHED",
        toSee: plan.toSee,
        checkedInBy: deps.actorId,
      });
      await auditCheckIn(tx, deps, visitId, "MATCHED", plan.visitorTypeCode, plan.reasonCode);
      return { ok: true, visitId, name: plan.clientName };
    }

    // A non-client. Their number (if they gave one) may already be on file.
    let visitorId: string | null = null;
    let name = plan.name;
    if (plan.phone !== null) {
      await tx.lockIdentity(phoneKey(plan.phone));
      const known = await tx.visitorByPhone(plan.phone);
      if (known !== null) {
        if (plan.sameVisitorId !== known.id) {
          const last = known.lastVisitAt ? `, last here ${formatIsoDate(lagosDateOf(known.lastVisitAt))}` : "";
          return {
            ok: false,
            kind: "confirm_visitor",
            message: `That number is on file for ${known.name}${last}. Is this the same person?`,
            visitor: known,
          };
        }
        visitorId = known.id;
        name = known.name;
        await tx.lockIdentity(identityKey({ visitorId }));
        const open = await tx.openVisitOf({ visitorId });
        if (open !== null) return { ok: false, kind: "refused", message: alreadyIn(name, open, deps.now), field: null };
      }
    }

    if (visitorId === null) {
      visitorId = deps.newId();
      await tx.insertVisitor({ id: visitorId, displayName: plan.name, phone: plan.phone, organisation: plan.organisation, createdBy: deps.actorId });
      // Ids only: no name or number in the audit log.
      await tx.audit({
        actorId: deps.actorId,
        entity: "visitor",
        entityId: visitorId,
        action: "CREATE",
        before: null,
        after: { has_phone: plan.phone !== null, has_organisation: plan.organisation !== null, consent: true, via: "check-in" },
      });
    }

    await tx.insertVisit({
      id: visitId,
      visitorTypeCode: plan.visitorTypeCode,
      reasonCode: plan.reasonCode,
      clientId: null,
      clientNameLogged: null,
      visitorId,
      lookupOutcome: plan.lookupOutcome,
      toSee: plan.toSee,
      checkedInBy: deps.actorId,
    });
    await auditCheckIn(tx, deps, visitId, plan.lookupOutcome, plan.visitorTypeCode, plan.reasonCode, visitorId);
    return { ok: true, visitId, name };
  });
}

async function auditCheckIn(
  tx: VisitTx,
  deps: VisitDeps,
  visitId: string,
  outcome: LookupOutcome,
  type: VisitorTypeCode,
  reason: VisitReasonCode,
  visitorId: string | null = null,
): Promise<void> {
  // Codes and ids only. Never the client's name or id: it is portal data (006).
  await tx.audit({
    actorId: deps.actorId,
    entity: "visit",
    entityId: visitId,
    action: "CREATE",
    before: null,
    after: { visitor_type_code: type, reason_code: reason, lookup_outcome: outcome, visitor_id: visitorId, via: "check-in" },
  });
}

// ---------------------------------------------------------------------------------------
// Check out, and closing the day
// ---------------------------------------------------------------------------------------

export type CheckOutResult = { ok: true; name: string } | { ok: false; message: string };

function closedMessage(visit: VisitRecord): string {
  if (visit.voidedAt !== null) return `${visit.name}'s visit has been removed.`;
  const by = visit.checkedOutByName ? ` by ${visit.checkedOutByName}` : "";
  return visit.closeReason === "AUTO_CLOSED"
    ? `${visit.name}'s visit was already closed at the end of the day${by}.`
    : `${visit.name} was already checked out at ${timeLabel(visit.checkedOutAt!)}${by}.`;
}

export async function checkOut(input: { visitId: string }, deps: VisitDeps): Promise<CheckOutResult> {
  if (!isUuid(input.visitId)) return { ok: false, message: MESSAGES.stale };
  return deps.store.transaction(async (tx): Promise<CheckOutResult> => {
    await tx.lockVisit(input.visitId);
    const visit = await tx.findVisit(input.visitId);
    if (visit === null) return { ok: false, message: MESSAGES.stale };
    if (visit.voidedAt !== null || visit.checkedOutAt !== null) return { ok: false, message: closedMessage(visit) };
    if (!(await tx.checkOut({ id: visit.id, actorId: deps.actorId }))) return { ok: false, message: MESSAGES.stale };
    await tx.audit({
      actorId: deps.actorId,
      entity: "visit",
      entityId: visit.id,
      action: "UPDATE",
      before: { checked_out_at: null, close_reason: null },
      after: { close_reason: "NORMAL", via: "check-out" },
    });
    return { ok: true, name: visit.name };
  });
}

export type CloseDayResult = { ok: true; closed: number; skipped: { name: string; reason: string }[] } | { ok: false; message: string };

export async function closeDay(input: { visitIds: readonly string[] }, deps: VisitDeps): Promise<CloseDayResult> {
  const ids = [...new Set(input.visitIds.filter(isUuid))].sort();
  if (ids.length === 0) return { ok: false, message: "There are no visits to close." };
  if (ids.length > VISIT_LIMITS.maxCloseAtOnce) return { ok: false, message: `Close at most ${VISIT_LIMITS.maxCloseAtOnce} visits at once.` };

  return deps.store.transaction(async (tx): Promise<CloseDayResult> => {
    let closed = 0;
    const skipped: { name: string; reason: string }[] = [];
    // In id order, each person then their visit: two desks closing overlapping lists cannot deadlock.
    for (const id of ids) {
      await tx.lockVisit(id);
      const visit = await tx.findVisit(id);
      if (visit === null) {
        skipped.push({ name: "A visit", reason: "could not be found" });
        continue;
      }
      if (visit.voidedAt !== null || visit.checkedOutAt !== null) {
        skipped.push({ name: visit.name, reason: visit.voidedAt !== null ? "removed" : "already closed" });
        continue;
      }
      const at = await tx.autoClose({ id, actorId: deps.actorId });
      if (at === null) {
        skipped.push({ name: visit.name, reason: "changed a moment ago" });
        continue;
      }
      await tx.audit({
        actorId: deps.actorId,
        entity: "visit",
        entityId: id,
        action: "UPDATE",
        before: { checked_out_at: null, close_reason: null },
        after: { close_reason: "AUTO_CLOSED", closed_at: at.toISOString(), via: "end of day" },
      });
      closed += 1;
    }
    return { ok: true, closed, skipped };
  });
}

// ---------------------------------------------------------------------------------------
// Corrections
// ---------------------------------------------------------------------------------------

export const VISIT_CORRECTION_KINDS = ["checkin", "checkout", "reopen", "reason", "toSee", "type", "name", "phone", "void", "restore"] as const;
export type VisitCorrectionKind = (typeof VISIT_CORRECTION_KINDS)[number];

export interface VisitCorrectionInput {
  visitId: string;
  version: string;
  kind: string;
  /** checkin and checkout: HH:MM. */
  time: string;
  /** reason, type: a code. toSee, name, phone: the new text. */
  value: string;
  reason: string;
}

export type VisitCorrectionResult = { ok: true; message: string } | { ok: false; message: string };

const refuse = (message: string): VisitCorrectionResult => ({ ok: false, message });
const iso = (date: Date | null) => (date === null ? null : date.toISOString());

export async function correctVisit(input: VisitCorrectionInput, deps: VisitDeps): Promise<VisitCorrectionResult> {
  // 1. The reason comes first, before anything is read: no correction without one.
  const reason = typeof input.reason === "string" ? input.reason.trim() : "";
  if (reason === "") return refuse(MESSAGES.needsReason);
  if (reason.length > VISIT_LIMITS.maxReasonLength) return refuse(`Keep the reason under ${VISIT_LIMITS.maxReasonLength} characters.`);

  const kind = VISIT_CORRECTION_KINDS.find((candidate) => candidate === input.kind);
  if (kind === undefined) return refuse("That kind of correction is not known. Reload the page and try again.");
  if (!isUuid(input.visitId) || typeof input.version !== "string" || input.version === "") return refuse(MESSAGES.staleVersion);

  let hhmm = "";
  if (kind === "checkin" || kind === "checkout") {
    const parsed = parseClockTime(input.time);
    if (!parsed.ok) return refuse(parsed.message);
    hhmm = parsed.hhmm;
  }
  const value = typeof input.value === "string" ? input.value : "";

  return deps.store.transaction(async (tx): Promise<VisitCorrectionResult> => {
    await tx.lockVisit(input.visitId);
    const visit = await tx.findVisit(input.visitId);
    if (visit === null) return refuse(MESSAGES.staleVersion);
    if (kind === "restore") {
      if (visit.voidedAt === null) return refuse(`${visit.name}'s visit is not removed.`);
    } else if (visit.voidedAt !== null) {
      return refuse(`${visit.name}'s visit has been removed. Restore it first to change it.`);
    }
    if (visit.version !== input.version) return refuse(MESSAGES.staleVersion);

    const day = lagosDateOf(visit.checkedInAt);
    const inLabel = timeLabel(visit.checkedInAt);
    const isOpen = visit.checkedOutAt === null;
    const isClient = visit.clientId !== null;
    let correction: VisitCorrection;
    let entity: AuditEntry["entity"] = "visit";
    let entityId = visit.id;
    let before: Record<string, unknown>;
    let after: Record<string, unknown>;
    let message: string;

    switch (kind) {
      case "checkin": {
        const at = lagosInstantAt(day, hhmm);
        if (at.getTime() === visit.checkedInAt.getTime()) return refuse(`${visit.name}'s check-in is already ${inLabel}.`);
        if (at.getTime() > deps.now.getTime()) return refuse("That time has not happened yet.");
        if (visit.checkedOutAt !== null && at.getTime() >= visit.checkedOutAt.getTime()) {
          return refuse(`Check-in must be before the check-out, ${timeLabel(visit.checkedOutAt)}.`);
        }
        correction = { kind, checkedInAt: at };
        before = { checked_in_at: iso(visit.checkedInAt) };
        after = { checked_in_at: at.toISOString() };
        message = `${visit.name}: check-in changed from ${inLabel} to ${hhmm}.`;
        break;
      }
      case "checkout": {
        if (isOpen) return refuse(`${visit.name} has not been checked out. Use Check out.`);
        const at = lagosInstantAt(day, hhmm);
        if (visit.closeReason !== "AUTO_CLOSED" && at.getTime() === visit.checkedOutAt!.getTime()) {
          return refuse(`${visit.name}'s check-out is already ${timeLabel(visit.checkedOutAt!)}.`);
        }
        if (at.getTime() <= visit.checkedInAt.getTime()) return refuse(`Check-out must be after the check-in, ${inLabel}.`);
        if (at.getTime() > deps.now.getTime()) return refuse("That time has not happened yet.");
        correction = { kind, checkedOutAt: at };
        before = { checked_out_at: iso(visit.checkedOutAt), close_reason: visit.closeReason };
        after = { checked_out_at: at.toISOString(), close_reason: "NORMAL" };
        message =
          visit.closeReason === "AUTO_CLOSED"
            ? `${visit.name}: left at ${hhmm} (the visit had been closed at the end of the day with no time).`
            : `${visit.name}: check-out changed from ${timeLabel(visit.checkedOutAt!)} to ${hhmm}.`;
        break;
      }
      case "reopen": {
        if (isOpen) return refuse(`${visit.name} has not been checked out.`);
        if (visit.otherOpenSince !== null) return refuse(`${visit.name} is already checked in ${since(visit.otherOpenSince, deps.now)}. Check that visit out first.`);
        correction = { kind };
        before = { checked_out_at: iso(visit.checkedOutAt), close_reason: visit.closeReason };
        after = { checked_out_at: null, close_reason: null };
        message = `${visit.name} is back in the building: the check-out was undone.`;
        break;
      }
      case "reason": {
        const next = VISIT_REASONS.find((candidate) => candidate.code === value);
        if (next === undefined) return refuse(MESSAGES.reason);
        if (next.code === visit.reasonCode) return refuse(`The reason is already ${next.label}.`);
        correction = { kind, reasonCode: next.code };
        before = { reason_code: visit.reasonCode };
        after = { reason_code: next.code };
        message = `${visit.name}: reason changed from ${reasonLabel(visit.reasonCode)} to ${next.label}.`;
        break;
      }
      case "toSee": {
        const next = tidy(value);
        if (next.length > VISIT_LIMITS.maxToSeeLength) return refuse(`Keep who they came to see under ${VISIT_LIMITS.maxToSeeLength} characters.`);
        if ((next || null) === visit.toSee) return refuse(next === "" ? "Nobody is recorded as who they came to see." : `It already says ${next}.`);
        correction = { kind, toSee: next || null };
        before = { to_see: visit.toSee };
        after = { to_see: next || null };
        message = next === "" ? `${visit.name}: who they came to see was cleared.` : `${visit.name}: came to see ${next}.`;
        break;
      }
      case "type": {
        if (visit.lookupOutcome !== "NOT_LOOKED_UP") {
          return refuse("A client's visit cannot change type: it was looked up as a client. Remove it and check them in again.");
        }
        const next = VISITOR_TYPES.find((candidate) => candidate.code === value);
        if (next === undefined || next.code === "CLIENT") {
          return refuse("Only Realtor, Investor, Delivery and Visitor can be swapped. A client is checked in from New visit, with a lookup.");
        }
        if (next.code === visit.visitorTypeCode) return refuse(`The type is already ${next.label}.`);
        correction = { kind, visitorTypeCode: next.code };
        before = { visitor_type_code: visit.visitorTypeCode };
        after = { visitor_type_code: next.code };
        message = `${visit.name}: changed from ${typeLabel(visit.visitorTypeCode)} to ${next.label}.`;
        break;
      }
      case "name": {
        if (isClient || visit.visitorId === null) {
          return refuse("A client's name is the one the portal gave at check-in, and is kept as logged. If it is the wrong client, remove the visit and check them in again.");
        }
        const next = cleanDisplayName(value);
        if (next === "") return refuse(MESSAGES.name);
        if (next.length > VISIT_LIMITS.maxNameLength) return refuse(`Keep the name under ${VISIT_LIMITS.maxNameLength} characters.`);
        if (next === visit.name) return refuse(`The name is already ${next}.`);
        correction = { kind, visitorId: visit.visitorId, displayName: next };
        // Ids only in the audit log, never a name: that a name changed, and on whose visit.
        before = { display_name_changed: false, on_visit: visit.id };
        after = { display_name_changed: true, on_visit: visit.id };
        entity = "visitor";
        entityId = visit.visitorId;
        message = `The visitor's name was changed to ${next}, on this visit and their other visits.`;
        break;
      }
      case "phone": {
        if (isClient || visit.visitorId === null) return refuse("A client's details are the portal's. Nothing about them is kept here to change.");
        const phone = normalisePhone(value);
        if (phone.kind === "invalid") return refuse(phone.message);
        const next = phone.kind === "ok" ? phone.e164 : null;
        if (next === visit.phone) return refuse(next === null ? "No number is on file." : "That is already their number.");
        if (next !== null) {
          const other = await tx.visitorByPhone(next, visit.visitorId);
          if (other !== null) return refuse(`That number is already on file for ${other.name}. If this is the same person, tell an administrator; the records are not merged here.`);
        }
        correction = { kind, visitorId: visit.visitorId, phone: next };
        before = { has_phone: visit.phone !== null, on_visit: visit.id };
        after = { has_phone: next !== null, phone_changed: true, on_visit: visit.id };
        entity = "visitor";
        entityId = visit.visitorId;
        message = next === null ? "The visitor's number was removed." : "The visitor's number was changed.";
        break;
      }
      case "void": {
        // A visit that documents were handed over on is a fact the handover points at.
        if (visit.liveHandovers > 0) {
          return refuse(
            `${visit.name}'s visit has documents handed over recorded against it, so it cannot be removed. If those records are wrong, withdraw them first (each with a reason).`,
          );
        }
        correction = { kind };
        before = { voided: false };
        after = { voided: true };
        message = `${visit.name}'s visit was removed. It no longer counts anywhere, and can be restored.`;
        break;
      }
      case "restore": {
        if (isOpen && visit.otherOpenSince !== null) {
          return refuse(`${visit.name} is already checked in ${since(visit.otherOpenSince, deps.now)}, so this open visit cannot be restored. Check that one out first.`);
        }
        correction = { kind };
        before = { voided: true };
        after = { voided: false };
        message = `${visit.name}'s visit was restored.`;
        break;
      }
    }

    const applied = await tx.applyCorrection({ id: visit.id, version: input.version, actorId: deps.actorId, reason, correction });
    if (!applied) return refuse(MESSAGES.staleVersion);
    await tx.audit({
      actorId: deps.actorId,
      entity,
      entityId,
      action: "UPDATE",
      before,
      after: { ...after, correction: kind, correction_reason: reason, via: "correction" },
    });
    // A visitor's details changed: the visit they were changed from is marked too.
    if (entity === "visitor") {
      await tx.audit({
        actorId: deps.actorId,
        entity: "visit",
        entityId: visit.id,
        action: "UPDATE",
        before: {},
        after: { correction: kind, correction_reason: reason, via: "correction" },
      });
    }
    return { ok: true, message };
  });
}
