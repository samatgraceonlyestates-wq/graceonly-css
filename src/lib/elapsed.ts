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

// MM:SS under an hour (04:12), H:MM:SS from an hour (1:05:12): a visitor kept two hours
// must not read as "125:40".
export function formatElapsed(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  const mmss = `${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
  return hours > 0 ? `${hours}:${mmss}` : `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}
