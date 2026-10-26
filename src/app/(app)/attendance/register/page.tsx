// SCREEN 08, THE ATTENDANCE REGISTER, on real data: the screen the owner's boss reads.
//
// ADMIN-ONLY, enforced HERE on the server before any data is loaded: requireRole("ADMIN")
// below (a Super Admin passes too). Anyone else gets a plain notice and the register is never
// built for them. The nav's "Attendance" link points at the board (/attendance), not here.
//
// It shows, for one Lagos day or a period (?from=YYYY-MM-DD&to=YYYY-MM-DD):
//  * every LIVE record, grouped by department (people with none in their own group, last);
//    removed records are in no list and no count, and only their number is mentioned
//  * WHO ENTERED each record: the arrival and the departure SEPARATELY (two front-desk people
//    are often both involved), and a "Who entered" summary for the period. One person typing
//    everyone else's attendance is the accountability story, so it is never hidden.
//  * any record CORRECTED (who, when, why), RESTORED (who, when, why), BACK-DATED (why), or with
//    a SELF-APPROVED movement, marked in its row. In a period, a person's plain completed
//    shifts fold away; marked ones never do: a reader sees a change without going looking.
//  * late by the threshold copied onto each record when it was entered (016), never by the
//    setting as it is now: changing the setting does not re-judge a past period
//  * HOURS by the rules in register.ts: the total is completed shifts only and the shifts with
//    UNKNOWN hours (no sign-out, never closed) are always counted beside it, with a sentence
//    saying how much of the period the total does not cover.
// UNDESIGNED beyond Figma 32:2 / 32:168, which drew a sample day. Shared components and
// tokens only. The Figma "◀ date ▶" is now a real period form; there are no arrows.
import type { Metadata } from "next";
import { Button } from "@/components/Button/Button";
import { Card } from "@/components/Card/Card";
import { Duration } from "@/components/Duration/Duration";
import { FilterChips } from "@/components/FilterChips/FilterChips";
import { Notice } from "@/components/Notice/Notice";
import { PageHeader } from "@/components/PageHeader/PageHeader";
import { PersonCell } from "@/components/PersonCell/PersonCell";
import { StatTile } from "@/components/StatTile/StatTile";
import { StatusPill } from "@/components/StatusPill/StatusPill";
import { requireRole } from "@/lib/auth";
import { cx } from "@/lib/cx";
import { timeLabel } from "@/lib/departureTime";
import { formatDuration, formatIsoDate, formatLongDate } from "@/lib/format";
import { lagosAddDays, lagosDateOf, lagosMonthOf, lagosWeekdayIndex, lagosWeekOf } from "@/lib/lagosTime";
import {
  buildRegister,
  honestyNote,
  isLate,
  isMarked,
  knownHoursMs,
  parsePeriod,
  shiftKind,
  type RegisterPerson,
  type RegisterRecord,
  type Totals,
} from "@/lib/register";
import { loadRegister } from "@/lib/registerStore";
import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "Staff attendance — CSS",
};

// Real data: render per request, never at build time.
export const dynamic = "force-dynamic";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
/** "Mon 19 Oct" for a Lagos date. */
const shortDay = (date: string) => `${WEEKDAYS[lagosWeekdayIndex(date)]} ${formatIsoDate(date).replace(/ \d{4}$/, "")}`;

const fact = (label: string, value: React.ReactNode, className?: string) => (
  <div className={cx(styles.fact, className)}>
    <span className={styles.factLabel}>{label}</span>
    <span className={styles.factValue}>{value}</span>
  </div>
);

const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

export default async function AttendanceRegisterPage({ searchParams }: { searchParams: Promise<{ from?: string | string[]; to?: string | string[] }> }) {
  const { allowed } = await requireRole("ADMIN");
  if (!allowed) {
    return (
      <Notice tone="limited" title="Administrators only" role="status">
        <p>The attendance register is for administrators. If you need it, ask an administrator to give you the role.</p>
      </Notice>
    );
  }

  const now = new Date();
  const asOf = now.toISOString();
  const today = lagosDateOf(now);
  const params = await searchParams;
  const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);
  const period = parsePeriod(one(params.from), one(params.to), today);
  const { from, to } = period;
  const singleDay = from === to;

  const data = await loadRegister(from, to);
  const register = buildRegister({ records: data.records, staff: data.staff, leave: data.leave, from, to, today });
  const { totals } = register;
  const honest = honestyNote(totals);

  // Quick periods: plain links, so the URL says what is shown.
  const week = lagosWeekOf(today);
  const month = lagosMonthOf(today);
  const lastMonth = lagosMonthOf(lagosAddDays(month.first, -1));
  const presets = [
    { label: "Today", from: today, to: today },
    { label: "Yesterday", from: lagosAddDays(today, -1), to: lagosAddDays(today, -1) },
    { label: "This week", from: week.first, to: today },
    { label: "This month", from: month.first, to: today },
    { label: "Last month", from: lastMonth.first, to: lastMonth.last },
  ];

  // Only the first that matches is lit (on a Monday, "This week" is the same period as "Today").
  const shownPreset = presets.find((preset) => preset.from === from && preset.to === to);

  // Each record is judged by its own snapshot; when the period spans a change of rule, say so.
  const mixedRules = register.lateRules.length > 1;
  const lateCaption =
    (register.lateRules.length === 0
      ? "no late rule was recorded"
      : mixedRules
        ? `by each day's rule (${register.lateRules.join(", ")})`
        : `in after ${register.lateRules[0]}`) + (totals.lateUnknown > 0 ? ` · ${totals.lateUnknown} unknown` : "");

  const periodWords = singleDay ? formatLongDate(from) : `${formatLongDate(from)} to ${formatLongDate(to)}`;
  const correctedWhen = (at: Date) => `${timeLabel(at)}, ${formatIsoDate(lagosDateOf(at))}`;

  // ---- one record: its cells, then its marks (full width) --------------------------------
  const recordCells = (record: RegisterRecord) => {
    const kind = shiftKind(record, today);
    // Judged by the threshold copied onto the record when it was entered (016), never today's setting.
    const late = isLate(record.clockInAt, record.lateAfterLocal);
    const hours = knownHoursMs(record);
    return (
      <>
        {!singleDay ? fact("Day", shortDay(lagosDateOf(record.clockInAt)), styles.cellDay) : null}
        {fact(
          "In",
          <>
            <span className={cx(styles.time, late === true && styles.late)}>{timeLabel(record.clockInAt)}</span>
            {late === true ? <StatusPill tone="amber">{mixedRules ? `Late · after ${record.lateAfterLocal}` : "Late"}</StatusPill> : null}
            {late === null ? <StatusPill tone="neutral">Late: unknown</StatusPill> : null}
            <span className={styles.by}>entered by {record.clockInByName ?? "unknown"}</span>
          </>,
        )}
        {fact(
          "Out",
          kind === "complete" ? (
            <>
              <span className={styles.time}>{timeLabel(record.clockOutAt!)}</span>
              <span className={styles.by}>entered by {record.clockOutByName ?? "unknown"}</span>
            </>
          ) : kind === "noSignout" ? (
            <>
              <StatusPill tone="red">No sign-out</StatusPill>
              <span className={styles.by}>marked by {record.signoutMissingByName ?? "unknown"}</span>
            </>
          ) : kind === "openEarlier" ? (
            <>
              <StatusPill tone="red">Never closed</StatusPill>
              <span className={styles.by}>still open on the board</span>
            </>
          ) : (
            <>
              <StatusPill tone="green">Still in</StatusPill>
            </>
          ),
        )}
        {fact(
          "Hours",
          hours !== null ? (
            <span className={styles.time}>{formatDuration(hours)}</span>
          ) : kind === "inProgress" ? (
            <span className={styles.unknown}>
              <Duration since={record.clockInAt.toISOString()} asOf={asOf} /> so far, not in the total
            </span>
          ) : (
            <span className={styles.unknown}>Unknown, not in the total</span>
          ),
        )}
        {fact(
          "Movements",
          record.movements === 0 ? (
            "None"
          ) : (
            <>
              {plural(record.movements, "movement")}
              {record.selfApprovedMovements > 0 ? <StatusPill tone="amber">Self-approved</StatusPill> : null}
            </>
          ),
          styles.cellMovements,
        )}
      </>
    );
  };

  const recordMarks = (record: RegisterRecord) => {
    const marks: React.ReactNode[] = [];
    if (record.correctedAt !== null) {
      marks.push(
        <p key="corrected" className={styles.mark}>
          <StatusPill tone="steel">Corrected</StatusPill>
          <span>
            Changed at {correctedWhen(record.correctedAt)} by {record.correctedByName ?? "someone"}: <q>{record.correctionReason}</q>
          </span>
        </p>,
      );
    }
    if (record.restoredAt !== null) {
      marks.push(
        <p key="restored" className={styles.mark}>
          <StatusPill tone="steel">Restored</StatusPill>
          <span>
            Removed, then put back at {correctedWhen(record.restoredAt)} by {record.restoredByName ?? "someone"}: <q>{record.restoredReason}</q>
          </span>
        </p>,
      );
    }
    if (record.backdateReason !== null) {
      marks.push(
        <p key="backdated" className={styles.mark}>
          <StatusPill tone="neutral">Back-dated</StatusPill>
          <span>
            Entered on a later day: <q>{record.backdateReason}</q>
          </span>
        </p>,
      );
    }
    if (record.selfApprovedMovements > 0) {
      marks.push(
        <p key="self" className={styles.mark}>
          <StatusPill tone="amber">Self-approved</StatusPill>
          <span>
            {record.selfApprovedMovements === record.movements && record.movements === 1
              ? "Their movement that day was approved by themselves."
              : `${record.selfApprovedMovements} of ${record.movements} movements that day were approved by the person themselves.`}
          </span>
        </p>,
      );
    }
    return marks.length > 0 ? <div className={styles.marks}>{marks}</div> : null;
  };

  // ---- a person's totals (a period): never a total without its unknowns beside it ---------
  const hoursLine = (t: Totals) => (
    <>
      <span className={styles.time}>{t.complete > 0 ? formatDuration(t.knownMs) : "None known"}</span>
      <span className={styles.by}>from {plural(t.complete, "completed shift")}</span>
      {t.unknown > 0 ? <StatusPill tone="red">{t.unknown} unknown</StatusPill> : null}
      {t.inProgress > 0 ? <StatusPill tone="green">{t.inProgress} in progress</StatusPill> : null}
    </>
  );

  const personBlock = (person: RegisterPerson) => {
    const sub = person.leaveDays > 0 ? `${person.leaveKinds.join(", ")} · ${plural(person.leaveDays, "day")} in this period` : undefined;
    if (singleDay) {
      return (
        <li key={person.staffId} className={styles.person}>
          {person.records.map((record) => (
            <div key={record.id} className={styles.dayRow}>
              <PersonCell name={person.name} sub={sub} size={36} className={styles.personCell} />
              {recordCells(record)}
              {recordMarks(record)}
            </div>
          ))}
        </li>
      );
    }
    const marked = person.records.filter((record) => isMarked(record, today));
    const plain = person.records.filter((record) => !isMarked(record, today));
    const t = person.totals;
    return (
      <li key={person.staffId} className={styles.person}>
        <div className={styles.summaryRow}>
          <PersonCell name={person.name} sub={sub} size={36} className={styles.personCell} />
          {fact(
            "Shifts",
            <>
              <span className={styles.time}>{t.shifts}</span>
              {t.late > 0 ? <StatusPill tone="amber">{t.late} late</StatusPill> : null}
            </>,
          )}
          {fact("Hours", hoursLine(t), styles.cellWide)}
          {fact("Arrivals entered by", person.enteredBy.map((entry) => `${entry.name} (${entry.count})`).join(", ") || "unknown", styles.cellWide)}
        </div>
        {marked.length > 0 ? (
          <ul className={styles.records} aria-label={`${person.name}: shifts to look at`}>
            {marked.map((record) => (
              <li key={record.id} className={styles.recordRow}>
                {recordCells(record)}
                {recordMarks(record)}
              </li>
            ))}
          </ul>
        ) : null}
        {plain.length > 0 ? (
          <details className={styles.more}>
            <summary className={styles.moreSummary}>
              {marked.length > 0 ? `${plural(plain.length, "other shift")}, all complete and unchanged` : `${plural(plain.length, "shift")}, all complete and unchanged`}
            </summary>
            <ul className={styles.records}>
              {plain.map((record) => (
                <li key={record.id} className={styles.recordRow}>
                  {recordCells(record)}
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </li>
    );
  };

  const groupSummary = (t: Totals) =>
    `${plural(t.shifts, "shift")} · ${t.complete > 0 ? formatDuration(t.knownMs) : "no hours"} known from ${plural(t.complete, "completed shift")}` +
    (t.unknown > 0 ? ` · ${t.unknown} unknown` : "") +
    (t.inProgress > 0 ? ` · ${t.inProgress} in progress` : "");

  const chips = [
    { label: "All departments", count: register.groups.reduce((sum, group) => sum + group.people.length, 0), selected: true },
    ...register.groups.map((group) => ({ label: group.label, count: group.people.length })),
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
        lede={`${periodWords}${singleDay ? "" : ` · ${plural(register.days, "day")}`}`}
        actions={
          // TODO: Export has no backend yet. Rendered enabled, wired to nothing.
          <Button size="compact">
            <span className={styles.desktopInline}>Export timesheet</span>
            <span className={styles.mobileInline}>Export</span>
          </Button>
        }
      />

      {/* The period: a plain GET form, and quick links. The day is always in words beside it. */}
      <div className={styles.period}>
        <form method="get" action="/attendance/register" className={styles.periodForm}>
          <label className={styles.periodField}>
            <span className={styles.factLabel}>From</span>
            <input className={styles.dateInput} type="date" name="from" max={today} defaultValue={from} />
          </label>
          <label className={styles.periodField}>
            <span className={styles.factLabel}>To</span>
            <input className={styles.dateInput} type="date" name="to" max={today} defaultValue={to} />
          </label>
          <Button type="submit" variant="row-action">
            Show
          </Button>
        </form>
        <nav className={styles.presets} aria-label="Quick periods">
          {presets.map((preset) => (
            <Button
              key={preset.label}
              href={`/attendance/register?from=${preset.from}&to=${preset.to}`}
              variant="row-action"
              className={cx(preset === shownPreset && styles.presetOn)}
            >
              {preset.label}
            </Button>
          ))}
        </nav>
      </div>

      {period.problem !== null ? (
        <Notice tone="limited" role="status">
          <p>{period.problem}</p>
        </Notice>
      ) : null}

      <p className={styles.copyNote}>
        A copy of the paper book: it shows what the front desk typed, and who typed it, not proof that anyone was present. Hours are time in to time out;
        movements are not deducted.
      </p>

      <section className={styles.kpis} aria-label="Attendance summary">
        <StatTile label="Shifts" value={totals.shifts} dot dense caption={plural(totals.people, "person", "people")} />
        <StatTile
          label="Late"
          value={totals.late}
          tone="amber"
          dot
          dense
          caption={lateCaption}
        />
        <StatTile
          label="Hours known"
          shortLabel="Known"
          value={totals.complete > 0 ? formatDuration(totals.knownMs) : "None"}
          tone="green"
          dot
          dense
          caption={`from ${plural(totals.complete, "completed shift")}`}
        />
        <StatTile
          label="Hours unknown"
          shortLabel="Unknown"
          value={plural(totals.unknown, "shift")}
          tone="red"
          dot
          dense
          caption={`${totals.noSignout} no sign-out · ${totals.openEarlier} never closed`}
        />
      </section>

      {honest !== null ? (
        <Notice tone={honest.serious ? "limited" : "info"} title={honest.serious ? "The hours total is incomplete" : "What the hours total leaves out"} role="status">
          <p>{honest.text}</p>
        </Notice>
      ) : null}

      {data.removedCount > 0 ? (
        <p className={styles.copyNote}>
          {plural(data.removedCount, "removed record")} in this period {data.removedCount === 1 ? "is" : "are"} not counted anywhere here (entered for the
          wrong person; they are listed on the board for their day).
        </p>
      ) : null}

      {/* STATIC (counts only, not controls), as before: people with a record, by department, from the data. */}
      <FilterChips label="People by department" items={chips} />

      {register.enteredBy.length > 0 ? (
        <Card as="section" padding="md" aria-labelledby="entered-heading" className={styles.section}>
          <h2 id="entered-heading" className={styles.sectionTitle}>
            Who entered
          </h2>
          <p className={styles.sectionNote}>What each front-desk person typed in this period. Arrivals and departures are counted separately.</p>
          <ul className={styles.enteredList}>
            {register.enteredBy.map((entry) => (
              <li key={entry.name} className={styles.enteredRow}>
                <PersonCell name={entry.name} size={32} className={styles.personCell} />
                {fact("Arrivals", entry.arrivals)}
                {fact("Departures", entry.departures)}
                {fact("No sign-out marks", entry.noSignoutMarks)}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {register.groups.length === 0 ? (
        <Card padding="md">
          <p className={styles.sectionNote}>No attendance was recorded {singleDay ? "that day" : "in this period"}.</p>
        </Card>
      ) : null}

      {register.groups.map((group, at) => (
        <Card key={group.label} as="section" padding="md" aria-labelledby={`dept-${at}`} className={styles.section}>
          <div className={styles.sectionHead}>
            <h2 id={`dept-${at}`} className={styles.sectionTitle}>
              {group.label} <span className={styles.sectionCount}>{group.people.length}</span>
            </h2>
            <p className={styles.sectionNote}>{groupSummary(group.totals)}</p>
          </div>
          <ul className={styles.people}>{group.people.map(personBlock)}</ul>
        </Card>
      ))}

      {register.onLeaveOnly.length > 0 ? (
        <Card as="section" padding="md" aria-labelledby="leave-heading" className={styles.section}>
          <h2 id="leave-heading" className={styles.sectionTitle}>
            On leave <span className={styles.sectionCount}>{register.onLeaveOnly.length}</span>
          </h2>
          <ul className={styles.nameList}>
            {register.onLeaveOnly.map((person) => (
              <li key={person.staffId}>
                <PersonCell name={person.name} sub={`${person.leaveKinds.join(", ")} · ${plural(person.leaveDays, "day")}`} size={32} />
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {register.noRecord.length > 0 ? (
        <Card as="section" padding="md" aria-labelledby="norecord-heading" className={styles.section}>
          <h2 id="norecord-heading" className={styles.sectionTitle}>
            No record {singleDay ? "that day" : "in this period"} <span className={styles.sectionCount}>{register.noRecord.length}</span>
          </h2>
          <p className={styles.sectionNote}>Nothing was typed for these people and they had no leave. That is not proof they were absent.</p>
          <ul className={styles.nameList}>
            {register.noRecord.map((person) => (
              <li key={person.id}>
                <PersonCell name={person.name} sub={person.department ?? "No department"} size={32} />
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}
