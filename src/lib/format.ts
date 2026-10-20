// TODO: confirm the office time zone; assumed Nigeria (Graceonly Estates Limited).
const TIME_ZONE = "Africa/Lagos";

export function getClockParts(now: Date) {
  const part = (options: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat("en-US", { timeZone: TIME_ZONE, ...options }).format(now);

  return {
    weekdayLong: part({ weekday: "long" }),
    weekdayShort: part({ weekday: "short" }),
    day: part({ day: "numeric" }),
    month: part({ month: "short" }).toUpperCase(),
    monthShort: part({ month: "short" }),
    monthLong: part({ month: "long" }),
    year: part({ year: "numeric" }),
    time12: part({ hour: "numeric", minute: "2-digit", hour12: true }).replace(/ /g, " "),
    time24: part({ hour: "2-digit", minute: "2-digit", hourCycle: "h23" }),
    hour: Number(part({ hour: "numeric", hourCycle: "h23" })),
  };
}

// Monday is 0 ... Sunday is 6, in the office time zone.
export function weekdayIndexMonFirst(now: Date): number {
  const short = new Intl.DateTimeFormat("en-US", { timeZone: TIME_ZONE, weekday: "short" }).format(now);
  return ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(short);
}

export const NO_TIME = "— : —";

// "08:47" (24-hour) for an ISO timestamp, or the empty-time placeholder.
export function timeOfDay(iso: string | null): string {
  return iso ? getClockParts(new Date(iso)).time24 : NO_TIME;
}

export function greetingForHour(hour: number): string {
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

// "1h 55m", "0h 00m"
export function formatDuration(ms: number): string {
  const totalMinutes = Math.max(0, Math.floor(ms / 60_000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}h ${String(minutes).padStart(2, "0")}m`;
}

// "3d 2h", "6h", "45m"
export function formatAge(ms: number): string {
  const totalMinutes = Math.max(0, Math.floor(ms / 60_000));
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h`;
  return `${minutes}m`;
}

// Integer kobo as naira: 500000 -> "₦5,000.00". Built by hand, no locale data.
export function formatNaira(kobo: number): string {
  const sign = kobo < 0 ? "-" : "";
  const absolute = Math.abs(kobo);
  const naira = Math.floor(absolute / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${sign}₦${naira}.${String(absolute % 100).padStart(2, "0")}`;
}

// "2026-08-18" -> "18 Aug 2026". The portal sends these as SQL-formatted
// strings; they are split, never parsed as timestamps, so no time zone can move
// the day. Anything that is not YYYY-MM-DD is returned as it came.
export function formatIsoDate(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return value;
  const month = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][Number(match[2]) - 1];
  return month ? `${Number(match[3])} ${month} ${match[1]}` : value;
}

// The first name for a greeting or a button ("Check in Lara"). A leading title
// ("Mrs.", "Dr.") is skipped. A one-word name is returned as it is.
export function firstName(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const first = words[0] ?? "";
  return words.length > 1 && first.endsWith(".") ? words[1] : first;
}
