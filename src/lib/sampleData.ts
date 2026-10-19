// TODO: PLACEHOLDER DATA. Every name, number and timestamp in this file is
// made up to match the Figma mockups. It will be replaced by real data:
// visits from CSS's own log, complaints from the portal API (read-only).
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

export type SampleComplaint = {
  id: string;
  title: string;
  raisedBy: string;
  team: string;
  raisedAt: string; // ISO timestamp; age and its colour are computed from this
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

export function getDashboardSample(now: Date) {
  const ago = (ms: number) => new Date(now.getTime() - ms).toISOString();
  const allVisits = getVisitsSample(now);

  const stats: Record<"visitsToday" | "activeNow" | "openComplaints" | "docsReleased", Stat> = {
    visitsToday: { value: 47, delta: { direction: "up", text: "+12%" } },
    activeNow: { value: allVisits.length, delta: { direction: "up", text: "+3" } },
    openComplaints: { value: 3, delta: { direction: "down", text: "-1" } },
    docsReleased: { value: 12, delta: { direction: "up", text: "+5" } },
  };

  // Ages: 3d 2h (74h, red), 1d 4h (28h, amber), 6h (neutral).
  const complaints: SampleComplaint[] = [
    {
      id: "c1",
      title: "Receipt not reflected",
      raisedBy: "Mrs. Okolo",
      team: "Finance",
      raisedAt: ago(3 * DAY + 2 * HOUR),
    },
    {
      id: "c2",
      title: "Deed delay",
      raisedBy: "Mr. Nnamdi",
      team: "Legal",
      raisedAt: ago(1 * DAY + 4 * HOUR),
    },
    {
      id: "c3",
      title: "Commission query",
      raisedBy: "B. Umeh",
      team: "Partners",
      raisedAt: ago(6 * HOUR),
    },
  ];

  return {
    asOf: now.toISOString(),
    user: currentUser,
    stats,
    visits: allVisits.slice(0, 5),
    complaints,
  };
}
