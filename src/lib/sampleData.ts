// TODO: PLACEHOLDER DATA. Every name, number and timestamp in this file is
// made up to match the Figma mockups. It will be replaced by real data:
// visits and attendance from CSS's own log, complaints from the portal API
// (read-only).
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

export type SampleStaff = {
  id: string;
  name: string;
  dept: string;
  clockInAt: string | null; // ISO timestamp, null when there is no clock-in
  clockOutAt: string | null;
  onLeave?: boolean;
};

// 24 staff, so the register agrees with its own totals: 19 present, 3 late,
// 1 absent, 1 on leave. The first nine are the people named in the Figma
// mockup. TODO: the other fifteen are invented placeholders (all on time).
//
// The sample day is ANCHORED TO `now`, like the visits list. The mockup is a
// 10:42 snapshot; each clock-in is `now` minus the time it was before 10:42
// there, so every duration equals the design's (1h 55m, 3h 12m, ...) whenever
// the page is opened, and none is ever in the future. Clock-in times of day
// therefore move with `now`, and so does the late line: it keeps the design's
// offset (09:15 is 87 minutes before 10:42). Real data uses the fixed 09:15
// rule instead. `now` is floored to the minute so durations are exact.
const DESIGN_NOW_MINUTES = 10 * 60 + 42;
const DESIGN_LATE_AFTER_MINUTES = 9 * 60 + 15;

export function getAttendanceSample(now: Date): { staff: SampleStaff[]; lateAfterAt: string } {
  const nowMinute = Math.floor(now.getTime() / MINUTE) * MINUTE;
  const designTime = (hhmm: string) => {
    const [h, m] = hhmm.split(":").map(Number);
    return new Date(nowMinute - (DESIGN_NOW_MINUTES - (h * 60 + m)) * MINUTE).toISOString();
  };
  const staff = (
    id: string,
    name: string,
    dept: string,
    clockIn: string | null,
    onLeave = false,
  ): SampleStaff => ({
    id,
    name,
    dept,
    clockInAt: clockIn ? designTime(clockIn) : null,
    clockOutAt: null,
    onLeave,
  });

  const people = [
    staff("s1", "Mariam Yusuf", "Legal", "08:47"),
    staff("s2", "Sam Okonkwo", "Front desk", "07:30"),
    staff("s3", "Chukwuma Eze", "Partners", "09:28"),
    staff("s4", "Blessing Ike", "Finance", "08:55"),
    staff("s5", "Daniel Johnson", "Admin", null),
    staff("s6", "Grace Nkem", "HR", null, true),
    staff("s7", "Peter Obi", "Admin", "09:16"),
    staff("s8", "Chidera Nnamdi", "Legal", "08:40"),
    staff("s9", "Faith Udo", "Partners", "09:21"),
    // Placeholders below.
    staff("s10", "Amaka Obi", "Legal", "08:05"),
    staff("s11", "Tunde Bello", "Finance", "08:20"),
    staff("s12", "Ngozi Adeyemi", "Front desk", "07:45"),
    staff("s13", "Ifeanyi Okeke", "Admin", "08:10"),
    staff("s14", "Zainab Musa", "Partners", "08:35"),
    staff("s15", "Emeka Nwankwo", "Finance", "08:50"),
    staff("s16", "Funke Adebisi", "Legal", "07:55"),
    staff("s17", "Kelechi Ibe", "Front desk", "08:00"),
    staff("s18", "Halima Garba", "HR", "08:30"),
    staff("s19", "Obinna Eze", "Partners", "08:15"),
    staff("s20", "Yetunde Cole", "Finance", "09:00"),
    staff("s21", "Segun Alabi", "Admin", "08:25"),
    staff("s22", "Ada Onuoha", "Legal", "09:05"),
    staff("s23", "Musa Danjuma", "Front desk", "07:40"),
    staff("s24", "Bisi Taiwo", "Admin", "08:45"),
  ];

  return {
    staff: people,
    lateAfterAt: new Date(
      nowMinute - (DESIGN_NOW_MINUTES - DESIGN_LATE_AFTER_MINUTES) * MINUTE,
    ).toISOString(),
  };
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
