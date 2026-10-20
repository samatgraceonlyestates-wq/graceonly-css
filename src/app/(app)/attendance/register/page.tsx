// TODO: ADMIN-ONLY. The attendance register is for admins, but the role gate
// is not built yet, so for now anyone signed in can open this route. The
// "Attendance" nav link points at /attendance (a person's own attendance, 07),
// not here.

import type { ReactNode } from "react";
import type { Metadata } from "next";
import { Button } from "@/components/Button/Button";
import { Card } from "@/components/Card/Card";
import { Duration } from "@/components/Duration/Duration";
import { FilterChips } from "@/components/FilterChips/FilterChips";
import { PageHeader } from "@/components/PageHeader/PageHeader";
import { PersonCell } from "@/components/PersonCell/PersonCell";
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
import { cx } from "@/lib/cx";
import { attendanceState, type AttendanceState } from "@/lib/attendance";
import { getClockParts } from "@/lib/format";
import { getAttendanceSample, type SampleStaff } from "@/lib/sampleData";
import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "Staff attendance — CSS",
};

// Live front-desk state: render per request, never at build time.
export const dynamic = "force-dynamic";

const NO_TIME = "— : —";

// Long labels on desktop, short ones in the mobile cards (Figma 32:168).
const STATUS = {
  present: { tone: "green", long: "Present", short: "OK" },
  late: { tone: "amber", long: "Late", short: "Late" },
  absent: { tone: "red", long: "Absent", short: "Absent" },
  leave: { tone: "steel", long: "On leave", short: "Leave" },
} as const;

function timeOfDay(iso: string | null): string {
  return iso ? getClockParts(new Date(iso)).time24 : NO_TIME;
}

function mobileSub(staff: SampleStaff, state: AttendanceState, asOf: string): ReactNode {
  const clockIn = timeOfDay(staff.clockInAt);
  if (state === "leave") return `${staff.dept} · ${clockIn} · On leave`;
  if (!staff.clockInAt) return `${staff.dept} · ${clockIn} · 0h 00m`;
  return (
    <>
      {staff.dept} · {clockIn} · <Duration since={staff.clockInAt} asOf={asOf} />
    </>
  );
}

export default function AttendanceRegisterPage() {
  const now = new Date();
  const asOf = now.toISOString();
  const clock = getClockParts(now);

  const sample = getAttendanceSample(now);
  const staff = sample.staff.map((person) => ({
    person,
    state: attendanceState(person, sample.lateAfterAt),
  }));
  const count = (state: AttendanceState) => staff.filter((entry) => entry.state === state).length;

  // Departments and their counts come from the staff themselves (in order of
  // first appearance), so the chips always add up to "All departments".
  const departments = [...new Set(staff.map((entry) => entry.person.dept))];
  const chips = [
    { label: "All departments", count: staff.length, selected: true },
    ...departments.map((dept) => ({
      label: dept,
      count: staff.filter((entry) => entry.person.dept === dept).length,
    })),
  ];

  return (
    <div className={styles.page}>
      <PageHeader
        className={styles.header}
        eyebrow={
          <>
            <span className={styles.desktopInline}>Admin · HR · Attendance register</span>
            <span className={styles.mobileInline}>Admin · HR</span>
          </>
        }
        title="Staff attendance"
        ledeSize="sm"
        lede={
          <>
            <span className={styles.desktopInline}>
              {clock.weekdayLong}, {clock.day} {clock.monthLong} {clock.year} · showing all {staff.length} staff
            </span>
            <span className={styles.mobileInline}>
              {clock.weekdayShort} {clock.day} {clock.monthShort}
            </span>
          </>
        }
        actions={
          <>
            {/* TODO: the design draws "◀ Fri 16 Oct 2026 ▶", one text layer with no
                prototype link. Rendered as a static label without the arrows, since
                arrows would promise a day stepper. Stepping needs a date in the
                route and per-date data. */}
            <span className={styles.datePill}>
              {clock.weekdayShort} {clock.day} {clock.monthShort} {clock.year}
            </span>
            {/* TODO: Export has no backend yet. Rendered enabled, wired to nothing. */}
            <Button size="compact">
              <span className={styles.desktopInline}>Export timesheet</span>
              <span className={styles.mobileInline}>Export</span>
            </Button>
          </>
        }
      />

      <section className={styles.kpis} aria-label="Attendance summary">
        <StatTile label="Present" value={count("present")} tone="green" dot dense caption="clocked in today" />
        <StatTile
          label="Late"
          value={count("late")}
          tone="amber"
          dot
          dense
          caption={`after ${getClockParts(new Date(sample.lateAfterAt)).time24}`}
        />
        <StatTile label="Absent" value={count("absent")} tone="red" dot dense caption="no clock-in" />
        <StatTile label="On leave" value={count("leave")} dot dense caption="approved" />
      </section>

      {/* TODO: STATIC for now, like the visit filters: counts only, not
          interactive. Shown on mobile too, wrapping, although the mobile frame
          omits this row: an admin on a phone should keep the breakdown. */}
      <FilterChips label="Staff by department" items={chips} />

      <Card padding="table" plainOnMobile className={styles.tableWrap}>
        <Table>
          <TableHead>
            <TableRow>
              <TableHeaderCell width="276px">Staff</TableHeaderCell>
              <TableHeaderCell width="156px">Dept</TableHeaderCell>
              <TableHeaderCell width="126px">Clock in</TableHeaderCell>
              <TableHeaderCell width="126px">Clock out</TableHeaderCell>
              <TableHeaderCell width="126px">Duration</TableHeaderCell>
              <TableHeaderCell>Status</TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {staff.map(({ person, state }) => {
              const status = STATUS[state];
              const hasClockIn = Boolean(person.clockInAt);

              return (
                <TableRow key={person.id} className={styles.row}>
                  <TableCell className={styles.cellPerson}>
                    {/* One instance per row: size, text and sub line change by CSS variable. */}
                    <PersonCell
                      className={styles.person}
                      name={person.name}
                      size="responsive"
                      sub={mobileSub(person, state, asOf)}
                    />
                  </TableCell>
                  <TableCell hideOnMobile>{person.dept}</TableCell>
                  <TableCell
                    hideOnMobile
                    className={cx(styles.strong, !hasClockIn && styles.muted, state === "late" && styles.late)}
                  >
                    {timeOfDay(person.clockInAt)}
                  </TableCell>
                  <TableCell hideOnMobile>{timeOfDay(person.clockOutAt)}</TableCell>
                  <TableCell hideOnMobile className={cx(styles.strong, !hasClockIn && styles.muted)}>
                    {state === "leave" ? (
                      "ON LEAVE"
                    ) : person.clockInAt ? (
                      <Duration since={person.clockInAt} asOf={asOf} />
                    ) : (
                      "0h 00m"
                    )}
                  </TableCell>
                  <TableCell className={styles.cellStatus}>
                    <StatusPill tone={status.tone} compactOnMobile>
                      <span className={styles.desktopInline}>{status.long}</span>
                      <span className={styles.mobileInline}>{status.short}</span>
                    </StatusPill>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
