export type ElapsedTone = "green" | "amber" | "red";

// Green under 10 minutes, amber 10 to 30, red over 30 (see CLAUDE.md).
export const AMBER_FROM_SECONDS = 10 * 60;
export const RED_AFTER_SECONDS = 30 * 60;

export function elapsedSeconds(checkInAt: string, nowMs: number): number {
  return Math.max(0, Math.floor((nowMs - Date.parse(checkInAt)) / 1000));
}

export function elapsedTone(seconds: number): ElapsedTone {
  if (seconds < AMBER_FROM_SECONDS) return "green";
  if (seconds <= RED_AFTER_SECONDS) return "amber";
  return "red";
}

export function formatElapsed(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}
