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
