// A time of day as the front desk types it off the paper book. Pure and
// browser-safe (the arrivals form and the server both use it).
//
// Exactly three shapes are accepted: 8:15, 08:15 and 0815, on the 24-hour clock.
// Anything else is REFUSED with a message, never read as something close: a
// guessed time is a wrong attendance record that nobody will question. In
// particular "815" is refused (is it 8:15 or 81:5?), and so is "8:15pm".

export type ClockTimeResult = { ok: true; hhmm: string } | { ok: false; message: string };

const COLON_FORM = /^(\d{1,2}):(\d{2})$/;
const FOUR_DIGITS = /^(\d{2})(\d{2})$/;

const WRONG_SHAPE = "Type the time as 08:15, 8:15 or 0815 (24-hour clock).";

/** "8:15", "08:15" or "0815" to "08:15"; anything else to a message. */
export function parseClockTime(raw: string): ClockTimeResult {
  const text = raw.trim();
  if (text === "") return { ok: false, message: "Enter a time." };
  const match = COLON_FORM.exec(text) ?? FOUR_DIGITS.exec(text);
  if (match === null) return { ok: false, message: WRONG_SHAPE };
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return { ok: false, message: "That is not a time of day. The hour is 00 to 23 and the minutes 00 to 59." };
  return { ok: true, hhmm: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}` };
}
