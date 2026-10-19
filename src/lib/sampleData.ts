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
  reason: string;
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
const HOUR = 3600 * SECOND;
const DAY = 24 * HOUR;

export function getDashboardSample(now: Date) {
  const ago = (ms: number) => new Date(now.getTime() - ms).toISOString();

  const stats: Record<"visitsToday" | "activeNow" | "openComplaints" | "docsReleased", Stat> = {
    visitsToday: { value: 47, delta: { direction: "up", text: "+12%" } },
    activeNow: { value: 7, delta: { direction: "up", text: "+3" } },
    openComplaints: { value: 3, delta: { direction: "down", text: "-1" } },
    docsReleased: { value: 12, delta: { direction: "up", text: "+5" } },
  };

  // Elapsed: 04:12, 08:45, 12:33, 00:48, 21:07 (green, green, amber, green, amber).
  const visits: SampleVisit[] = [
    {
      id: "v1",
      name: "Chidinma Okafor",
      kind: "Client",
      detail: "GraceWaters",
      reason: "Document",
      checkInAt: ago(4 * 60 * SECOND + 12 * SECOND),
    },
    {
      id: "v2",
      name: "Benedict Umeh",
      kind: "Realtor",
      detail: "New",
      reason: "Onboarding",
      checkInAt: ago(8 * 60 * SECOND + 45 * SECOND),
    },
    {
      id: "v3",
      name: "Mrs. Okolo",
      kind: "Client",
      detail: "GracePool",
      reason: "Complaint",
      checkInAt: ago(12 * 60 * SECOND + 33 * SECOND),
    },
    {
      id: "v4",
      name: "DHL Courier",
      kind: "Delivery",
      reason: "Package",
      checkInAt: ago(48 * SECOND),
    },
    {
      id: "v5",
      name: "Mr. Adebayo",
      kind: "Investor",
      reason: "Meeting",
      checkInAt: ago(21 * 60 * SECOND + 7 * SECOND),
    },
  ];

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

  return { asOf: now.toISOString(), user: currentUser, stats, visits, complaints };
}
