// TODO: PLACEHOLDER DATA. Every name, number and timestamp in this file is
// made up to match the Figma mockups. It will be replaced by real data:
// visits from CSS's own log, complaints from the portal's case
// endpoints (designed, not built yet). Attendance (07, 08) already reads the
// database and has no sample here.
//
// Timestamps are built relative to `now` so the elapsed times and ages shown
// on screen always agree with the check-in / raised-at values behind them.

export type Direction = "up" | "down";
export type Stat = { value: number; delta: { direction: Direction; text: string } };

export type SampleVisit = {
  id: string;
  name: string;
  kind: string; // Client, Realtor, Delivery, Investor
  detail?: string; // project / status, shown after the kind on desktop
  reason: string; // short chip label (dashboard, mobile)
  reasonLong?: string; // long chip label (visit log, desktop); falls back to reason
  checkInAt: string; // ISO timestamp
};

// A complaint, shaped like a row of the PORTAL's `disputes` table (the portal
// owns complaints; CSS has no complaint tables). Not shaped for the mockup.
export type DisputeStatus = "OPEN" | "IN_PROGRESS" | "AWAITING_CLIENT" | "RESOLVED" | "WITHDRAWN";
export type DisputeChannel = "PORTAL" | "PHONE" | "WHATSAPP" | "IN_PERSON" | "EMAIL";
export type DisputeRaisedByRole = "CLIENT" | "ADMIN";

export type DisputeKind = "ISSUE" | "QUESTION";

// The portal's ten SEEDED dispute_types, mirrored exactly. A new type is an
// INSERT in the portal's dispute_types table, not a migration, so this list can
// grow without a schema change on either side.
//
// The labels are CLIENT-FACING wording ("my documents", "my plot"): the portal
// shows them to clients, so at a staff desk they read oddly. Do NOT rewrite
// them; they are the portal's data. If CSS should show different wording, that
// is a later decision and a MAPPING on top of these, not an edit to them.
//
// Every type targets a PURCHASE except REALTOR_CONDUCT and OTHER, which target
// nothing (`targetsPurchase: false`).
export const DISPUTE_TYPES = {
  // ISSUE kind
  // TODO: the exact label for PAYMENT_NOT_REFLECTED is not available yet. Until
  // it is, the UI shows the type code (see disputeTypeText), so nothing invented
  // can be mistaken for the portal's wording.
  PAYMENT_NOT_REFLECTED: { kind: "ISSUE", label: null, targetsPurchase: true },
  WRONG_AMOUNT_CHARGED: { kind: "ISSUE", label: "Wrong amount charged", targetsPurchase: true },
  DOCUMENT_ISSUE: { kind: "ISSUE", label: "A document is wrong or missing", targetsPurchase: true },
  BOUNDARY_OR_ENCROACHMENT: { kind: "ISSUE", label: "Boundary or encroachment", targetsPurchase: true },
  REALTOR_CONDUCT: { kind: "ISSUE", label: "A concern about a realtor", targetsPurchase: false },
  // QUESTION kind
  DOCUMENT_RELEASE_CHASE: {
    kind: "QUESTION",
    label: "Chasing or speeding up my documents",
    targetsPurchase: true,
  },
  DOCUMENTATION_FEE_QUERY: {
    kind: "QUESTION",
    label: "A question about the documentation fee",
    targetsPurchase: true,
  },
  ESTATE_TIMELINE: {
    kind: "QUESTION",
    label: "When will development start or finish?",
    targetsPurchase: true,
  },
  PLOT_OR_ALLOCATION: {
    kind: "QUESTION",
    label: "A question about my plot or allocation",
    targetsPurchase: true,
  },
  OTHER: { kind: "QUESTION", label: "Something else", targetsPurchase: false },
} as const satisfies Record<string, { kind: DisputeKind; label: string | null; targetsPurchase: boolean }>;

export type DisputeTypeCode = keyof typeof DISPUTE_TYPES;

// REALTOR_CONDUCT is record-only: it can never be read back by a CSS key, so
// CSS can never hold one. Excluding it here makes a sample case of that type a
// compile error, so nobody adds one later.
export type ReadableDisputeTypeCode = Exclude<DisputeTypeCode, "REALTOR_CONDUCT">;

export type SampleDispute = {
  id: string;
  referenceNo: string; // displayed as is, e.g. "CASE-0001"
  clientId: string;
  // TODO: clientName is ASSUMED. The list endpoint's response shape is not
  // specified yet; the portal row has clientId, and the name may have to be
  // joined or read separately.
  clientName: string;
  raisedByRole: DisputeRaisedByRole;
  channel: DisputeChannel;
  typeCode: ReadableDisputeTypeCode;
  typeLabel: string | null; // the type's label; null until PAYMENT_NOT_REFLECTED's is known
  kind: DisputeKind; // ISSUE or QUESTION, a real field of the type
  // ASSUMED field name: the purchase the case targets. Null exactly when the
  // type targets nothing (REALTOR_CONDUCT, OTHER).
  purchaseId: string | null;
  subject: string;
  description: string;
  status: DisputeStatus;
  version: number; // the row's version, for compare-and-set on writes
  raisedAt: string; // ISO timestamp; age and its colour are computed from this
  lastClientReplyAt: string | null;
  resolvedAt: string | null; // a resolved case's age freezes here
  resolutionNote: string | null;
  escalated: boolean;
};

// TODO: replace with the signed-in user from the session.
export const currentUser = { name: "Sam" };

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

// The ONE visit list. The dashboard shows the first five; the visit log (03)
// shows all seven, so the two screens cannot disagree.
// Elapsed: 04:12, 08:45, 12:33, 00:48, 21:07, 26:14, 36:32
// (green, green, amber, green, amber, amber, red).
export function getVisitsSample(now: Date): SampleVisit[] {
  const ago = (ms: number) => new Date(now.getTime() - ms).toISOString();

  return [
    {
      id: "v1",
      name: "Chidinma Okafor",
      kind: "Client",
      detail: "GraceWaters",
      reason: "Document",
      reasonLong: "Document collection",
      checkInAt: ago(4 * MINUTE + 12 * SECOND),
    },
    {
      id: "v2",
      name: "Benedict Umeh",
      kind: "Realtor",
      detail: "New",
      reason: "Onboarding",
      checkInAt: ago(8 * MINUTE + 45 * SECOND),
    },
    {
      id: "v3",
      name: "Mrs. Okolo",
      kind: "Client",
      detail: "GracePool",
      reason: "Complaint",
      checkInAt: ago(12 * MINUTE + 33 * SECOND),
    },
    {
      id: "v4",
      name: "DHL Courier",
      kind: "Delivery",
      reason: "Package",
      reasonLong: "Package drop",
      checkInAt: ago(48 * SECOND),
    },
    {
      id: "v5",
      name: "Mr. Adebayo",
      kind: "Investor",
      reason: "Meeting",
      reasonLong: "Scheduled meeting",
      checkInAt: ago(21 * MINUTE + 7 * SECOND),
    },
    {
      // The mobile frame omits this visit, so it has no designed short label.
      id: "v6",
      name: "Rita Nwosu",
      kind: "Client",
      detail: "GraceGardens",
      reason: "Contract signing",
      checkInAt: ago(26 * MINUTE + 14 * SECOND),
    },
    {
      id: "v7",
      name: "Kingsley Eze",
      kind: "Client",
      detail: "GraceWaters",
      reason: "Inquiry",
      checkInAt: ago(36 * MINUTE + 32 * SECOND),
    },
  ];
}

// What the UI shows for a case's type: the portal's label, or, while one is
// still unknown (PAYMENT_NOT_REFLECTED), the type code itself.
export function disputeTypeText(dispute: Pick<SampleDispute, "typeCode" | "typeLabel">): string {
  return dispute.typeLabel ?? dispute.typeCode;
}

// ---------------------------------------------------------------------------
// TODO: THE PORTAL READ BELONGS HERE. Complaints are the portal's data, read
// through its API with the service key sent in the X-Service-Key header; CSS
// never touches the portal database. NONE of the case endpoints are built yet:
// only the five read-only CLIENT endpoints exist. Until a case list endpoint
// exists this returns sample rows in the shape of the portal's `disputes` row.
// Writes (resolving, with a resolution note and the row's `version` for
// compare-and-set) will go to the portal as POST /support-cases/{id}/actions,
// never to a CSS table.
//
// The type codes and labels are the portal's seeded dispute_types (see
// DISPUTE_TYPES); kind, label and whether the type targets a purchase come from
// that table, so a sample row cannot disagree with it. NEVER add a
// REALTOR_CONDUCT case: that type is record-only and can never be read back by
// a CSS key (the types make it a compile error).
// A complaint belongs to a CLIENT. A non-client (for example a realtor asking
// about commission) gets an ENQUIRY in CSS's own log, never a case, so the
// mockup's "B. Umeh, commission query" card is not a case and is not here.
// ---------------------------------------------------------------------------
export function getComplaintsSample(now: Date): SampleDispute[] {
  const ago = (ms: number) => new Date(now.getTime() - ms).toISOString();

  type Fields = Omit<
    SampleDispute,
    "id" | "referenceNo" | "clientId" | "version" | "resolutionNote" | "typeLabel" | "kind" | "purchaseId"
  > &
    Partial<Pick<SampleDispute, "resolutionNote">>;

  // `purchase` is required for a type that targets a purchase and forbidden for
  // one that does not (OTHER), so the sample respects the portal's rule.
  const dispute = (n: number, purchase: string | null, fields: Fields): SampleDispute => {
    const type = DISPUTE_TYPES[fields.typeCode];
    if (type.targetsPurchase !== (purchase !== null)) {
      throw new Error(`sample case ${n}: ${fields.typeCode} ${type.targetsPurchase ? "needs" : "must not have"} a purchase`);
    }
    return {
      id: `dispute-${n}`,
      referenceNo: `CASE-${String(n).padStart(4, "0")}`,
      clientId: `client-${fields.clientName.toLowerCase().replace(/[^a-z]+/g, "-")}`,
      typeLabel: type.label,
      kind: type.kind,
      purchaseId: purchase,
      version: 1,
      resolutionNote: null,
      ...fields,
    };
  };

  // Open ages: 3d 2h (74h, red), 1d 4h (28h, amber), 6h (neutral).
  return [
    dispute(1, "purchase-okolo-1", {
      clientName: "Mrs. Okolo",
      raisedByRole: "ADMIN",
      channel: "IN_PERSON",
      typeCode: "PAYMENT_NOT_REFLECTED",
      subject: "Receipt not reflected in GOP",
      description:
        "Paid ₦500K cash on 12 Oct, receipt #R-4791 given. Payment never appeared in client portal account.",
      status: "OPEN",
      raisedAt: ago(3 * DAY + 2 * HOUR),
      lastClientReplyAt: null,
      resolvedAt: null,
      escalated: true,
    }),
    dispute(2, "purchase-nnamdi-1", {
      clientName: "Mr. Nnamdi",
      raisedByRole: "ADMIN",
      channel: "EMAIL",
      typeCode: "DOCUMENT_RELEASE_CHASE",
      subject: "Deed of Assignment delay",
      description:
        "Promised deed within 14 days (Sept 28). Still waiting; cannot proceed with building plan submission.",
      status: "OPEN",
      raisedAt: ago(1 * DAY + 4 * HOUR),
      lastClientReplyAt: null,
      resolvedAt: null,
      escalated: false,
    }),
    dispute(3, "purchase-eze-1", {
      clientName: "Kingsley Eze",
      raisedByRole: "CLIENT",
      channel: "PORTAL",
      typeCode: "ESTATE_TIMELINE",
      subject: "Development start date for the estate",
      description: "Asked twice when site development is due to start; no date given yet.",
      status: "OPEN",
      raisedAt: ago(6 * HOUR),
      lastClientReplyAt: null,
      resolvedAt: null,
      escalated: false,
    }),
    dispute(4, "purchase-nwosu-1", {
      clientName: "Rita Nwosu",
      raisedByRole: "ADMIN",
      channel: "WHATSAPP",
      typeCode: "BOUNDARY_OR_ENCROACHMENT",
      subject: "Neighbouring beacon appears moved",
      description: "Client sent photos of the corner beacon; survey team has been asked to recheck.",
      status: "IN_PROGRESS",
      raisedAt: ago(2 * DAY + 1 * HOUR),
      lastClientReplyAt: ago(1 * DAY),
      resolvedAt: null,
      escalated: false,
    }),
    dispute(5, "purchase-okafor-1", {
      clientName: "Chidinma Okafor",
      raisedByRole: "CLIENT",
      channel: "PORTAL",
      typeCode: "DOCUMENT_ISSUE",
      subject: "Allocation letter shows the wrong plot",
      description: "The plot number on the allocation letter does not match the payment schedule.",
      status: "IN_PROGRESS",
      raisedAt: ago(5 * DAY),
      lastClientReplyAt: ago(3 * DAY),
      resolvedAt: null,
      escalated: true,
    }),
    dispute(6, "purchase-eze-1", {
      clientName: "Kingsley Eze",
      raisedByRole: "ADMIN",
      channel: "PHONE",
      typeCode: "DOCUMENT_ISSUE",
      subject: "Name correction on the allocation letter",
      description: "Spelling of the surname is wrong; waiting for a copy of the client's ID.",
      status: "AWAITING_CLIENT",
      raisedAt: ago(4 * DAY),
      lastClientReplyAt: ago(2 * DAY),
      resolvedAt: null,
      escalated: false,
    }),
    dispute(7, "purchase-okafor-1", {
      clientName: "Chidinma Okafor",
      raisedByRole: "CLIENT",
      channel: "PORTAL",
      typeCode: "PAYMENT_NOT_REFLECTED",
      subject: "Instalment missing from statement",
      description: "September instalment was paid by transfer but is missing from the statement.",
      status: "RESOLVED",
      raisedAt: ago(9 * DAY),
      lastClientReplyAt: ago(6 * DAY),
      resolvedAt: ago(2 * DAY),
      resolutionNote: "Transfer matched and posted to the account.",
      escalated: false,
    }),
    dispute(8, "purchase-nnamdi-1", {
      clientName: "Mr. Nnamdi",
      raisedByRole: "ADMIN",
      channel: "IN_PERSON",
      typeCode: "WRONG_AMOUNT_CHARGED",
      subject: "Documentation fee charged twice",
      description: "Statement shows the documentation fee debited twice.",
      status: "RESOLVED",
      raisedAt: ago(14 * DAY),
      lastClientReplyAt: ago(12 * DAY),
      resolvedAt: ago(10 * DAY + 5 * HOUR),
      resolutionNote: "Duplicate charge reversed.",
      escalated: false,
    }),
    // OTHER targets no purchase, so it carries none.
    dispute(9, null, {
      clientName: "Rita Nwosu",
      raisedByRole: "ADMIN",
      channel: "EMAIL",
      typeCode: "OTHER",
      subject: "Service-charge schedule for the estate",
      description: "Asked for the yearly service-charge schedule by email.",
      status: "RESOLVED",
      raisedAt: ago(7 * DAY),
      lastClientReplyAt: null,
      resolvedAt: ago(6 * DAY),
      resolutionNote: "Schedule sent by email.",
      escalated: false,
    }),
    dispute(10, "purchase-okolo-1", {
      clientName: "Mrs. Okolo",
      raisedByRole: "ADMIN",
      channel: "EMAIL",
      typeCode: "PLOT_OR_ALLOCATION",
      subject: "Duplicate plot assigned",
      description: "Client raised this by email; later withdrawn after the duplicate was explained.",
      status: "WITHDRAWN",
      raisedAt: ago(20 * DAY),
      lastClientReplyAt: ago(18 * DAY),
      resolvedAt: null,
      escalated: false,
    }),
  ];
}

export function getDashboardSample(now: Date) {
  const allVisits = getVisitsSample(now);

  // The dashboard's complaints are the SAME portal-shaped list the complaint
  // queue (06) reads: the open ones, oldest first. One source, so they cannot
  // disagree.
  const complaints = getComplaintsSample(now)
    .filter((dispute) => dispute.status === "OPEN")
    .sort((a, b) => Date.parse(a.raisedAt) - Date.parse(b.raisedAt));

  const stats: Record<"visitsToday" | "activeNow" | "openComplaints" | "docsReleased", Stat> = {
    visitsToday: { value: 47, delta: { direction: "up", text: "+12%" } },
    activeNow: { value: allVisits.length, delta: { direction: "up", text: "+3" } },
    openComplaints: { value: complaints.length, delta: { direction: "down", text: "-1" } },
    docsReleased: { value: 12, delta: { direction: "up", text: "+5" } },
  };

  return {
    asOf: now.toISOString(),
    user: currentUser,
    stats,
    visits: allVisits.slice(0, 5),
    complaints,
  };
}

// ---------------------------------------------------------------------------
// Screen 05 (Visit Detail): the visit's own log.
//
// TODO: PLACEHOLDER. CSS's visit log does not exist yet, so none of this is a
// real visit. The check-in time, the reason and every timeline entry are made
// up and anchored to `now`, and the screen says so on its face. Replace this
// with a read of CSS's own visit store when it exists. The CLIENT data on the
// screen (name, estate, fee, documents, release position) is NOT sample: it is
// read live from the portal.
// ---------------------------------------------------------------------------
export type SampleTimelineEntry = {
  id: string;
  title: string;
  detail: string;
  at: string; // ISO timestamp
};

export function getVisitDetailSample(now: Date): { checkInAt: string; entries: SampleTimelineEntry[] } {
  const checkIn = now.getTime() - 14 * MINUTE;
  const at = (minutesAfter: number) => new Date(checkIn + minutesAfter * MINUTE).toISOString();

  return {
    checkInAt: at(0),
    entries: [
      { id: "sample-1", title: "Checked in", detail: "Reason: Inquiry · logged by front desk", at: at(0) },
      { id: "sample-2", title: "Portal lookup", detail: "Client found by name and picked by the desk", at: at(1) },
      { id: "sample-3", title: "Documents", detail: "Issued documents reviewed with the client", at: at(6) },
      { id: "sample-4", title: "Note", detail: "Asked about the next step on their purchase", at: at(9) },
    ],
  };
}
