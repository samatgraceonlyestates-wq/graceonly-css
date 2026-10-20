// Lagos day boundaries, in ONE place.
//
// Attendance is reckoned per Africa/Lagos day, the server is not in Lagos, and
// everything stored is timestamptz (an instant). So "today's register" is the
// half-open range of instants [start, end) that make up one Lagos calendar day,
// and a query asks for it with
//
//     WHERE clock_in_at >= ${range.start} AND clock_in_at < ${range.end}
//
// instead of casting, truncating or AT TIME ZONE-ing in each query. Convert here;
// never in SQL, never with the server's local time.
//
// Nothing in this file reads the process's time zone: no local getters, no
// Date.parse of a zoneless string. The zone is always named. Lagos has no
// daylight saving today, but the offset is looked up from the time zone data
// rather than hard-coded, and the next day's start is computed from the calendar
// date, not by adding 24 hours, so this stays correct if that ever changes.
//
// Calendar dates are "YYYY-MM-DD" strings (the same convention as the portal and
// the `leave` columns). They are never parsed as timestamps.
//
// No imports: it runs under Node's type stripping and in the tests directly.

export const LAGOS_TIME_ZONE = "Africa/Lagos";

export interface LagosDayRange {
  /** The Lagos calendar date, "YYYY-MM-DD". */
  date: string;
  /** The first instant of that day (inclusive). */
  start: Date;
  /** The first instant of the NEXT Lagos day (exclusive). */
  end: Date;
}

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

const parts = new Intl.DateTimeFormat("en-GB", {
  timeZone: LAGOS_TIME_ZONE,
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

interface WallClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function wallClock(instant: Date): WallClock {
  const found: Record<string, number> = {};
  for (const part of parts.formatToParts(instant)) {
    if (part.type !== "literal") found[part.type] = Number(part.value);
  }
  return {
    year: found.year ?? NaN,
    month: found.month ?? NaN,
    day: found.day ?? NaN,
    hour: found.hour ?? NaN,
    minute: found.minute ?? NaN,
    second: found.second ?? NaN,
  };
}

function pad(value: number, width: number): string {
  return String(value).padStart(width, "0");
}

function formatDate(year: number, month: number, day: number): string {
  return `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}`;
}

/** Validates "YYYY-MM-DD" as a real calendar date and returns its numbers. */
function parseDate(date: string): { year: number; month: number; day: number } {
  const match = DATE_PATTERN.exec(date);
  if (match === null) throw new RangeError("Expected a calendar date as YYYY-MM-DD.");
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  // Date.UTC rolls 31 February over to March; comparing the round trip catches it.
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) {
    throw new RangeError("Expected a real calendar date as YYYY-MM-DD.");
  }
  return { year, month, day };
}

/** The calendar date of an instant, in Lagos. 23:30 UTC on the 15th is already the 16th in Lagos. */
export function lagosDateOf(instant: Date): string {
  if (Number.isNaN(instant.getTime())) throw new RangeError("Invalid date.");
  const clock = wallClock(instant);
  return formatDate(clock.year, clock.month, clock.day);
}

/** Lagos wall clock minus UTC at this instant, in milliseconds. */
function offsetMillis(instant: Date): number {
  const clock = wallClock(instant);
  const asIfUtc = Date.UTC(clock.year, clock.month - 1, clock.day, clock.hour, clock.minute, clock.second);
  // Drop the milliseconds the formatter does not return.
  return asIfUtc - (instant.getTime() - instant.getUTCMilliseconds());
}

/** The instant at which the Lagos wall clock first reads 00:00:00 on the given date. */
function startOfLagosDate(year: number, month: number, day: number): Date {
  const wanted = Date.UTC(year, month - 1, day);
  // Guess with the offset at the UTC midnight, then correct once with the offset
  // at the guess. Two passes settle any zone whose offset changes at midnight.
  let guess = wanted - offsetMillis(new Date(wanted));
  guess = wanted - offsetMillis(new Date(guess));
  return new Date(guess);
}

function nextDate(year: number, month: number, day: number): { year: number; month: number; day: number } {
  const next = new Date(Date.UTC(year, month - 1, day + 1));
  return { year: next.getUTCFullYear(), month: next.getUTCMonth() + 1, day: next.getUTCDate() };
}

/**
 * The half-open range of instants making up one Lagos day. Pass a Lagos calendar
 * date ("2026-10-16") or an instant (the day it falls in, in Lagos).
 */
export function lagosDayRange(day: string | Date): LagosDayRange {
  const date = typeof day === "string" ? day : lagosDateOf(day);
  const { year, month, day: dayOfMonth } = parseDate(date);
  const following = nextDate(year, month, dayOfMonth);
  return {
    date,
    start: startOfLagosDate(year, month, dayOfMonth),
    end: startOfLagosDate(following.year, following.month, following.day),
  };
}

/**
 * The half-open range covering several Lagos days, first to last INCLUSIVE
 * (for a week or a month of attendance). Same rules as lagosDayRange.
 */
export function lagosDaysRange(firstDay: string, lastDay: string): { first: string; last: string; start: Date; end: Date } {
  const first = lagosDayRange(firstDay);
  const last = lagosDayRange(lastDay);
  if (last.start.getTime() < first.start.getTime()) throw new RangeError("The last day is before the first day.");
  return { first: first.date, last: last.date, start: first.start, end: last.end };
}
