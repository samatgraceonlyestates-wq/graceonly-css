export type ComplaintAgeTone = "neutral" | "amber" | "red";

const HOUR_MS = 3_600_000;

// Under 24 hours neutral, 24 to 72 hours amber, over 72 hours red (CLAUDE.md).
export const AMBER_FROM_MS = 24 * HOUR_MS;
export const RED_AFTER_MS = 72 * HOUR_MS;

export function complaintAgeMs(raisedAt: string, nowMs: number): number {
  return Math.max(0, nowMs - Date.parse(raisedAt));
}

export function complaintAgeTone(ageMs: number): ComplaintAgeTone {
  if (ageMs < AMBER_FROM_MS) return "neutral";
  if (ageMs <= RED_AFTER_MS) return "amber";
  return "red";
}
