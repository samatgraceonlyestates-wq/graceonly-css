// "08:15" for an instant, on the Lagos clock. Pure and browser-safe (the board's
// client controls and the server rules both use it).
const LAGOS = "Africa/Lagos";

const formatter = new Intl.DateTimeFormat("en-GB", { timeZone: LAGOS, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

export function timeLabel(instant: Date): string {
  return formatter.format(instant);
}
