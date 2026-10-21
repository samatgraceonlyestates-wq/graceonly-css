import type { ReactNode } from "react";
import type { Metadata } from "next";
import { Button } from "@/components/Button/Button";
import { Card } from "@/components/Card/Card";
import { Duration } from "@/components/Duration/Duration";
import { TargetPercent } from "@/components/TargetPercent/TargetPercent";
import { LiveClock } from "@/components/LiveClock/LiveClock";
import { PageHeader } from "@/components/PageHeader/PageHeader";
import { StatTile } from "@/components/StatTile/StatTile";
import { StatusPill } from "@/components/StatusPill/StatusPill";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from "@/components/Table/Table";
import { attendanceState, closedMs, shiftState, type AttendanceState } from "@/lib/attendance";
import { requireSession } from "@/lib/auth";
import { cx } from "@/lib/cx";
import { NO_TIME, formatDuration, getClockParts, greetingForHour, timeOfDay } from "@/lib/format";
import {
  getMyAttendanceSample,
  type MyAttendanceScenario,
  type SampleWeekDay,
} from "@/lib/sampleData";
import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "My attendance — CSS",
};

// Live front-desk state: render per request, never at build time.
export const dynamic = "force-dynamic";

const SCENARIOS: MyAttendanceScenario[] = ["not-clocked-in", "on-shift", "complete"];

// Lede copy per state. The first is the design's line (Figma 31:6), which is
// the not-clocked-in copy; the other two are new.
const LEDE: Record<MyAttendanceScenario, string> = {
  "not-clocked-in": "Clock in to start the day. We'll run the clock until you clock out.",
  "on-shift": "You're on shift. The clock runs until you clock out.",
  complete: "You've clocked out for today. Your hours are in the week below.",
};

const STATE_PILL = {
  present: { tone: "green", label: "On time" },
  late: { tone: "amber", label: "Late" },
  absent: { tone: "red", label: "Absent" },
  leave: { tone: "steel", label: "On leave" },
} as const;

type Pill = { tone: "green" | "amber" | "red" | "steel" | "neutral"; label: string };

type WeekRow = {
  key: string;
  longLabel: string;
  shortLabel: string;
  isToday: boolean;
  clockIn: string;
  clockOut: string;
  late: boolean;
  duration: ReactNode;
  summary: ReactNode; // the mobile right-hand text
  pill: Pill | null;
  statusText: string | null; // desktop status when there is no pill
};

function buildRow(day: SampleWeekDay, asOfIso: string): WeekRow {
  const date = getClockParts(new Date(day.date));
  const base = {
    key: day.date,
    longLabel: `${date.weekdayLong} ${date.day}`,
    shortLabel: `${date.weekdayShort} ${date.day}`,
    isToday: day.kind === "today",
  };

  if (day.kind === "future") {
    return { ...base, clockIn: NO_TIME, clockOut: NO_TIME, late: false, duration: "—", summary: "—", pill: null, statusText: "—" };
  }

  const isOpen = Boolean(day.clockInAt) && !day.clockOutAt;
  const dayState: AttendanceState = attendanceState(day, day.lateAfterAt);

  if (day.kind === "today" && !day.clockInAt) {
    return {
      ...base,
      clockIn: NO_TIME,
      clockOut: NO_TIME,
      late: false,
      duration: "0h 00m",
      summary: "Not yet",
      pill: { tone: "neutral", label: "Not clocked in" },
      statusText: null,
    };
  }

  const spec = STATE_PILL[dayState];
  const pill: Pill = { tone: spec.tone, label: isOpen ? "In progress" : spec.label };
  const late = dayState === "late";
  const clockIn = timeOfDay(day.clockInAt);

  if (dayState === "leave" || dayState === "absent") {
    return {
      ...base,
      clockIn: NO_TIME,
      clockOut: NO_TIME,
      late: false,
      duration: "0h 00m",
      summary: `${spec.label} · —`,
      pill,
      statusText: null,
    };
  }

  const duration: ReactNode = isOpen ? (
    <Duration since={day.clockInAt!} asOf={asOfIso} />
  ) : (
    formatDuration(closedMs(day))
  );

  return {
    ...base,
    clockIn,
    clockOut: timeOfDay(day.clockOutAt),
    late,
    duration,
    summary: (
      <>
        {clockIn}
        {late ? " late" : ""} · {duration}
      </>
    ),
    pill,
    statusText: null,
  };
}

export default async function MyAttendancePage({
  searchParams,
}: {
  searchParams: Promise<{ scenario?: string }>;
}) {
  await requireSession();
  // TODO: sample-only preview switch (see getMyAttendanceSample); remove it
  // when auth and a backend exist. It is honoured ONLY outside production: in
  // a production build the query string is never read and the real record is
  // used, so ?scenario= cannot change what anyone sees.
  const requested = process.env.NODE_ENV !== "production" ? (await searchParams).scenario : undefined;
  const scenario = SCENARIOS.find((value) => value === requested) ?? "on-shift";

  const now = new Date();
  const asOf = now.toISOString();
  const clock = getClockParts(now);
  const sample = getMyAttendanceSample(now, scenario);

  const state = shiftState(sample.today);
  const todayState = attendanceState(sample.today, sample.today.lateAfterAt);
  const shiftTone = todayState === "late" ? "amber" : "green";

  // ---------- week rows ----------
  const rows: WeekRow[] = sample.week.map((day) => buildRow(day, asOf));

  const weekClosedMs = sample.week.reduce((sum, day) => sum + closedMs(day), 0);
  const todayDay = sample.week.find((day) => day.kind === "today");
  const openSince =
    todayDay && todayDay.clockInAt && !todayDay.clockOutAt ? todayDay.clockInAt : null;

  const monthClosedMs = sample.monthPriorMs + weekClosedMs;
  const lateDays = sample.week.filter(
    (day) => attendanceState(day, day.lateAfterAt) === "late",
  ).length;

  // A running total ticks with the open shift; otherwise it is a fixed readout.
  const total = (closedBase: number): ReactNode =>
    openSince ? (
      <Duration since={openSince} asOf={asOf} plusMs={closedBase} />
    ) : (
      formatDuration(closedBase)
    );
  const share = (closedBase: number, targetMs: number): ReactNode =>
    openSince ? (
      <TargetPercent since={openSince} asOf={asOf} plusMs={closedBase} targetMs={targetMs} />
    ) : (
      `${Math.round((closedBase / targetMs) * 100)}%`
    );

  const monday = new Date(sample.week[0].date);
  const friday = new Date(sample.week[4].date);
  const mon = getClockParts(monday);
  const fri = getClockParts(friday);
  const range = `${mon.weekdayShort} ${mon.day}${mon.monthShort !== fri.monthShort ? ` ${mon.monthShort}` : ""} — ${fri.weekdayShort} ${fri.day} ${fri.monthShort}`;

  const clockInSub = state === "not-clocked-in" ? "Not yet" : todayState === "late" ? "Late" : "On time";
  const clockOutSub = state === "complete" ? "Clocked out" : "Not yet";

  return (
    <div className={styles.page}>
      <PageHeader
        eyebrow="Staff · Attendance"
        title={
          <>
            <span className={styles.desktopInline}>
              {greetingForHour(clock.hour)}, {sample.user.name}.
            </span>
            <span className={styles.mobileInline}>My attendance</span>
          </>
        }
        lede={LEDE[scenario]}
        ledeHiddenOnMobile
        // PLACEHOLDER entry point (not in Figma): the front desk reaches the arrivals
        // sheet from here until this screen becomes the "who is in right now" board.
        actions={
          <Button variant="row-action" href="/attendance/arrivals">
            Enter arrivals →
          </Button>
        }
      />

      {/* ---------- the clock ---------- */}
      <Card padding="xl" className={styles.clock}>
        <div className={styles.clockLeft}>
          {state === "on-shift" ? (
            <StatusPill tone={shiftTone} size="large">
              On shift · <Duration since={sample.today.clockInAt!} asOf={asOf} />
            </StatusPill>
          ) : state === "complete" ? (
            <StatusPill tone={shiftTone} size="large">
              Shift complete · {formatDuration(closedMs(sample.today))}
            </StatusPill>
          ) : (
            <StatusPill tone="neutral" size="large">
              Not clocked in
            </StatusPill>
          )}
          <LiveClock asOf={asOf} part="time" className={styles.time} />
          <LiveClock asOf={asOf} part="date" className={styles.date} />
        </div>

        <div className={styles.clockRight}>
          <div className={styles.io}>
            <div className={styles.block}>
              <span className={styles.blockLabel}>Clocked in</span>
              <span className={cx(styles.blockValue, state === "not-clocked-in" && styles.muted)}>
                {timeOfDay(sample.today.clockInAt)}
              </span>
              <span className={styles.blockSub}>{clockInSub}</span>
            </div>
            <div className={styles.block}>
              <span className={styles.blockLabel}>Clock out</span>
              <span className={cx(styles.blockValue, state !== "complete" && styles.muted)}>
                {timeOfDay(sample.today.clockOutAt)}
              </span>
              <span className={styles.blockSub}>{clockOutSub}</span>
            </div>
          </div>

          {/* TODO: Clock in / Clock out have no backend yet. Rendered enabled,
              wired to nothing, the same way Check out is on the visit log. A
              completed shift has no action. */}
          {state === "not-clocked-in" ? (
            <Button size="large">Clock in →</Button>
          ) : state === "on-shift" ? (
            <Button size="large">Clock out →</Button>
          ) : null}
        </div>
      </Card>

      {/* ---------- week and totals ---------- */}
      <div className={styles.body}>
        <Card className={styles.week}>
          <div className={styles.weekHeader}>
            <h2 className={styles.weekTitle}>
              This week
              <span className={styles.mobileInline}>
                {" · "}
                {total(weekClosedMs)}
              </span>
            </h2>
            <span className={styles.range}>{range}</span>
          </div>

          <Table mobileLayout="rules" className={styles.weekTable}>
            <TableHead>
              <TableRow>
                <TableHeaderCell width="196px">Day</TableHeaderCell>
                <TableHeaderCell>Clock in</TableHeaderCell>
                <TableHeaderCell>Clock out</TableHeaderCell>
                <TableHeaderCell>Duration</TableHeaderCell>
                <TableHeaderCell>Status</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.key} className={styles.row}>
                  <TableCell className={styles.cellDay}>
                    <span className={styles.dayLabel}>
                      {row.pill ? (
                        <span className={styles.dot}>
                          <StatusPill tone={row.pill.tone} dotOnly>
                            {row.pill.label}
                          </StatusPill>
                        </span>
                      ) : null}
                      <span className={cx(styles.dayName, !row.pill && styles.upcoming)}>
                        <span className={styles.desktopInline}>{row.longLabel}</span>
                        <span className={styles.mobileInline}>{row.shortLabel}</span>
                        {row.isToday ? " (today)" : null}
                      </span>
                    </span>
                    <span className={styles.summary}>{row.summary}</span>
                  </TableCell>
                  <TableCell hideOnMobile className={cx(styles.nowrap, row.late && styles.late)}>
                    {row.clockIn}
                  </TableCell>
                  <TableCell hideOnMobile className={styles.nowrap}>
                    {row.clockOut}
                  </TableCell>
                  <TableCell hideOnMobile className={cx(styles.nowrap, styles.strong)}>
                    {row.duration}
                  </TableCell>
                  <TableCell hideOnMobile className={styles.nowrap}>
                    {row.pill ? (
                      <StatusPill tone={row.pill.tone}>{row.pill.label}</StatusPill>
                    ) : (
                      row.statusText
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>

        <div className={styles.totals}>
          <StatTile
            label="Week total"
            value={total(weekClosedMs)}
            caption={
              <>
                target {sample.weekTargetMs / 3_600_000}h · {share(weekClosedMs, sample.weekTargetMs)}
              </>
            }
            desktopOnly
          />
          <StatTile
            label="Month total"
            value={total(monthClosedMs)}
            caption={`target ${sample.monthTargetMs / 3_600_000}h`}
          />
          <StatTile label="Late days" value={lateDays} caption="this month" />
        </div>
      </div>
    </div>
  );

}
