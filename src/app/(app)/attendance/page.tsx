// UNDESIGNED: the today board is not in Figma. Screen 07 ("My Attendance") described
// someone who clocks themselves in; nobody does (CLAUDE.md, "ATTENDANCE: HOW IT
// REALLY WORKS"). It is now what the front desk looks at all day: who is IN, who is OUT
// on a movement, who has GONE, who has NO SIGN-OUT, and the place to clock people out
// one at a time and to close the day. Built from the shared components and tokens only.
//
// Gated on the server by requireAnyRole before anything is loaded; the actions gate
// themselves again. Everything shown is derived from the records (todayBoard.ts).
// Durations tick on the shared interval (<Duration />, useNow.ts): no timer here.
import type { Metadata } from "next";
import { Button } from "@/components/Button/Button";
import { Card } from "@/components/Card/Card";
import { Duration } from "@/components/Duration/Duration";
import { Notice } from "@/components/Notice/Notice";
import { PageHeader } from "@/components/PageHeader/PageHeader";
import { PersonCell } from "@/components/PersonCell/PersonCell";
import { StatTile } from "@/components/StatTile/StatTile";
import { StatusPill } from "@/components/StatusPill/StatusPill";
import { ARRIVAL_ROLES } from "@/lib/arrivalBatch";
import { requireAnyRole } from "@/lib/auth";
import { timeLabel } from "@/lib/departureTime";
import { loadTodayBoard } from "@/lib/departureStore";
import { formatDuration, formatLongDate } from "@/lib/format";
import type { BoardPerson } from "@/lib/todayBoard";
import { ClockOutControl } from "./ClockOutControl";
import { EndOfDay } from "./EndOfDay";
import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "Who is in — CSS",
};

// Live front-desk state: render per request, never at build time.
export const dynamic = "force-dynamic";

function Section({
  id,
  title,
  count,
  empty,
  children,
}: {
  id: string;
  title: string;
  count: number;
  empty: string;
  children: React.ReactNode;
}) {
  return (
    <Card as="section" padding="md" aria-labelledby={id} className={styles.section}>
      <h2 id={id} className={styles.sectionTitle}>
        {title} <span className={styles.sectionCount}>{count}</span>
      </h2>
      {count === 0 ? <p className={styles.empty}>{empty}</p> : <ul className={styles.list}>{children}</ul>}
    </Card>
  );
}

const fact = (label: string, value: React.ReactNode) => (
  <p className={styles.fact}>
    <span className={styles.factLabel}>{label}</span>
    {value}
  </p>
);

export default async function TodayBoardPage() {
  const { allowed } = await requireAnyRole(ARRIVAL_ROLES);
  if (!allowed) {
    return (
      <Notice tone="limited" title="Front desk only" role="status">
        <p>The attendance board is for the front desk. If you need it, ask an administrator to give you the role.</p>
      </Notice>
    );
  }

  const now = new Date();
  const asOf = now.toISOString();
  const board = await loadTodayBoard(now);

  const sub = (person: BoardPerson) => person.department ?? undefined;

  return (
    <div className={styles.page}>
      <PageHeader
        eyebrow="Front desk · Today"
        title="Who is in"
        lede={`${formatLongDate(board.today)} · as of ${timeLabel(now)}`}
        ledeSize="sm"
        actions={<Button href="/attendance/arrivals">Enter arrivals</Button>}
      />

      <div className={styles.tiles}>
        <StatTile label="In now" value={board.counts.in} tone="green" dot dense />
        <StatTile label="Out on a movement" shortLabel="Out" value={board.counts.out} tone="amber" dot dense />
        <StatTile label="Gone for the day" shortLabel="Gone" value={board.counts.gone} dense />
        <StatTile label="No sign-out" value={board.counts.noSignout} tone="red" dot dense />
      </div>

      <Section id="in-heading" title="In now" count={board.counts.in} empty="Nobody is recorded as in.">
        {board.inNow.map((person) => (
          <li key={person.id} className={styles.item}>
            <PersonCell name={person.name} sub={sub(person)} size={36} />
            {fact("In at", timeLabel(person.clockInAt))}
            {person.olderDay ? (
              <p className={styles.fact}>
                <span className={styles.factLabel}>Open since</span>
                <span className={styles.older}>{formatLongDate(person.arrivedOn)}</span>
              </p>
            ) : (
              fact("Here for", <Duration since={person.clockInAt.toISOString()} asOf={asOf} />)
            )}
            <ClockOutControl
              recordId={person.id}
              name={person.name}
              timeIn={timeLabel(person.clockInAt)}
              olderDay={person.olderDay ? formatLongDate(person.arrivedOn) : null}
              asOf={asOf}
            />
          </li>
        ))}
      </Section>

      <Section
        id="out-heading"
        title="Out on a movement"
        count={board.counts.out}
        empty="Nobody is recorded as out. Movements cannot be entered yet, so this stays empty for now."
      >
        {board.outNow.map((person) => (
          <li key={person.id} className={styles.item}>
            <PersonCell name={person.name} sub={sub(person)} size={36} />
            {fact("Left at", timeLabel(person.movement!.leftAt))}
            {fact("Gone to", `${person.movement!.destination} · ${person.movement!.purpose}`)}
            {fact("Approved by", person.movement!.approvedByName)}
          </li>
        ))}
      </Section>

      <Section id="gone-heading" title="Gone for the day" count={board.counts.gone} empty="Nobody has been clocked out yet today.">
        {board.gone.map((person) => (
          <li key={person.id} className={styles.item}>
            <PersonCell name={person.name} sub={sub(person)} size={36} />
            {fact("In", timeLabel(person.clockInAt))}
            {fact("Out", timeLabel(person.clockOutAt!))}
            {fact("Time", formatDuration(person.clockOutAt!.getTime() - person.clockInAt.getTime()))}
          </li>
        ))}
      </Section>

      <Section id="nosignout-heading" title="No sign-out" count={board.counts.noSignout} empty="Nobody has been marked as not signed out today.">
        {board.noSignout.map((person) => (
          <li key={person.id} className={styles.item}>
            <PersonCell name={person.name} sub={sub(person)} size={36} />
            {fact("In", timeLabel(person.clockInAt))}
            {fact("Out", "no time recorded")}
            <p className={styles.fact}>
              <StatusPill tone="amber">No sign-out</StatusPill>
              <span className={styles.unknown}>Hours unknown</span>
            </p>
          </li>
        ))}
      </Section>

      <EndOfDay people={board.inNow.map((person) => ({ id: person.id, name: person.name }))} />
    </div>
  );
}
