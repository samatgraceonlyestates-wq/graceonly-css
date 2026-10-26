// UNDESIGNED: the board is not in Figma. Screen 07 ("My Attendance") described someone
// who clocks themselves in; nobody does (CLAUDE.md, "ATTENDANCE: HOW IT REALLY WORKS").
// It is now what the front desk looks at all day: who is IN, who is OUT on a movement,
// who has GONE, who has NO SIGN-OUT, and the place to clock people out one at a time, to
// CORRECT a record (any day: ?day=YYYY-MM-DD) and to close the day. Built from the shared
// components and tokens only.
//
// Gated on the server by requireAnyRole before anything is loaded; the actions gate
// themselves again. Everything shown is derived from the records (todayBoard.ts).
// Durations tick, and the board refreshes, on the ONE shared interval (useNow.ts): there
// is no timer here. A record that has been corrected says so, in its row, with who, when
// and why; a removed record is left out of every list and count and appears only in
// "Removed records". A movement the person approved themselves is marked "Self-approved".
//
// FINDING A ROW: a filter box narrows the lists by name (BoardFilter.tsx) and never changes a
// count. ON A PHONE every row is collapsed to one line until opened (PersonRow.tsx); the
// desktop is unchanged.
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
import { loadArrivalRoster } from "@/lib/arrivalStore";
import { requireAnyRole } from "@/lib/auth";
import { timeLabel } from "@/lib/departureTime";
import { loadDayBoard } from "@/lib/departureStore";
import { formatDuration, formatIsoDate, formatLongDate } from "@/lib/format";
import { lagosDateOf, pastOrToday } from "@/lib/lagosTime";
import { loadMovementSuggestions } from "@/lib/movementStore";
import type { BoardMovement, BoardPerson } from "@/lib/todayBoard";
import { BoardDataProvider } from "./BoardData";
import { BoardFilterBox, BoardFilterProvider, FilterMiss } from "./BoardFilter";
import { BoardRefresher } from "./BoardRefresher";
import { EndOfDay } from "./EndOfDay";
import { MovementItem, type MovementView } from "./MovementItem";
import { PersonRow } from "./PersonRow";
import { RowActions, type RowState } from "./RowActions";
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
  names,
  children,
}: {
  id: string;
  title: string;
  count: number;
  empty: string;
  /** The names of its rows, so it can say when the filter box hides every one of them. */
  names: string[];
  children: React.ReactNode;
}) {
  return (
    <Card as="section" padding="md" aria-labelledby={id} className={styles.section}>
      <h2 id={id} className={styles.sectionTitle}>
        {title} <span className={styles.sectionCount}>{count}</span>
      </h2>
      {count === 0 ? <p className={styles.empty}>{empty}</p> : <ul className={styles.list}>{children}</ul>}
      <FilterMiss names={names} />
    </Card>
  );
}

const fact = (label: string, value: React.ReactNode) => (
  <p className={styles.fact}>
    <span className={styles.factLabel}>{label}</span>
    {value}
  </p>
);

export default async function BoardPage({ searchParams }: { searchParams: Promise<{ day?: string | string[] }> }) {
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
  const today = lagosDateOf(now);
  const day = pastOrToday((await searchParams).day, today);
  const board = await loadDayBoard(day, now);
  // The roster (for the approver of a movement) and what has been used before (for suggestions).
  const [roster, suggestions] = await Promise.all([loadArrivalRoster(), loadMovementSuggestions()]);

  const sub = (person: BoardPerson) => person.department ?? undefined;
  // Where the correction (if any) was made, in words a person reads: "Corrected 10:12 by Desk B: reason".
  const correctedWhen = (at: Date) => `${timeLabel(at)}${lagosDateOf(at) === board.today ? "" : `, ${formatIsoDate(lagosDateOf(at))}`}`;
  const note = (person: BoardPerson, removed = false) =>
    person.correctedAt !== null ? (
      <p className={styles.correctionNote}>
        <StatusPill tone="steel">{removed ? "Removed" : "Corrected"}</StatusPill>
        <span>
          {removed ? "Removed" : "Changed"} at {correctedWhen(person.correctedAt)} by {person.correctedByName ?? "someone"}:{" "}
          <q>{person.correctionReason}</q>
        </span>
      </p>
    ) : null;

  const movementView = (movement: BoardMovement, removed: boolean): MovementView => ({
    id: movement.id,
    version: movement.version,
    left: timeLabel(movement.leftAt),
    returned: movement.returnedAt ? timeLabel(movement.returnedAt) : null,
    leftIso: movement.leftAt.toISOString(),
    destination: movement.destination,
    purpose: movement.purpose,
    approvedBy: movement.approvedByName,
    selfApproved: movement.selfApproved,
    removed,
    note:
      movement.correctedAt !== null
        ? `${removed ? "Removed" : "Changed"} at ${correctedWhen(movement.correctedAt)} by ${movement.correctedByName ?? "someone"}: "${movement.correctionReason}"`
        : null,
  });

  // A person's movements today, under their row: where, what for, who approved it, when out and
  // back, and how to correct each. Removed ones are listed (struck through) so they can be restored.
  const movementsBlock = (person: BoardPerson) =>
    person.movements.length + person.removedMovements.length > 0 ? (
      <div className={styles.movements}>
        <p className={styles.movementsTitle}>Movements</p>
        <ul className={styles.movementList}>
          {person.movements.map((movement) => (
            <MovementItem key={movement.id} movement={movementView(movement, false)} asOf={asOf} />
          ))}
          {person.removedMovements.map((movement) => (
            <MovementItem key={movement.id} movement={movementView(movement, true)} asOf={asOf} />
          ))}
        </ul>
      </div>
    ) : null;

  const actions = (person: BoardPerson, state: RowState) => (
    <RowActions
      recordId={person.id}
      staffId={person.staffId}
      version={person.version}
      name={person.name}
      state={state}
      timeIn={timeLabel(person.clockInAt)}
      timeOut={person.clockOutAt ? timeLabel(person.clockOutAt) : null}
      olderDay={person.olderDay ? formatLongDate(person.arrivedOn) : null}
      openMovement={person.movement ? { id: person.movement.id, left: timeLabel(person.movement.leftAt) } : null}
      asOf={asOf}
    />
  );

  const { isToday } = board;
  const head = (person: BoardPerson) => <PersonCell name={person.name} sub={sub(person)} size={36} />;
  const names = (people: BoardPerson[]) => people.map((person) => person.name);
  // The one line a COLLAPSED row shows on a phone: enough to find the person and see their state.
  const corrected = (person: BoardPerson) => (person.correctedAt !== null ? " · Corrected" : "");

  return (
    <BoardDataProvider roster={roster} destinations={suggestions.destinations} purposes={suggestions.purposes}>
    <BoardFilterProvider names={names([...board.inNow, ...board.outNow, ...board.gone, ...board.noSignout, ...board.removed])}>
    <div className={styles.page}>
      <BoardRefresher asOf={asOf} />

      <PageHeader
        eyebrow={isToday ? "Front desk · Today" : "Front desk · An earlier day"}
        title={isToday ? "Who is in" : "Who was in"}
        lede={isToday ? `${formatLongDate(board.day)} · as of ${timeLabel(now)}` : formatLongDate(board.day)}
        ledeSize="sm"
        actions={<Button href="/attendance/arrivals">Enter arrivals</Button>}
      />

      {/* Look at another day (to correct it). A plain GET form: no script needed. */}
      <form method="get" action="/attendance" className={styles.dayForm}>
        <label className={styles.label} htmlFor="board-day">
          Day
        </label>
        <input id="board-day" className={styles.dayInput} type="date" name="day" max={today} defaultValue={board.day} />
        <Button type="submit" variant="row-action">
          Show
        </Button>
        {!isToday ? (
          <Button href="/attendance" variant="row-action">
            Back to today
          </Button>
        ) : null}
        <span className={styles.dayLong}>{formatLongDate(board.day)}</span>
      </form>

      <div className={styles.tiles}>
        <StatTile label={isToday ? "In now" : "Still open"} value={board.counts.in} tone="green" dot dense />
        <StatTile label="Out on a movement" shortLabel="Out" value={board.counts.out} tone="amber" dot dense />
        <StatTile label="Gone for the day" shortLabel="Gone" value={board.counts.gone} dense />
        <StatTile label="No sign-out" value={board.counts.noSignout} tone="red" dot dense />
      </div>

      <BoardFilterBox />

      <Section
        id="in-heading"
        title={isToday ? "In now" : "Still open (never closed)"}
        count={board.counts.in}
        empty={isToday ? "Nobody is recorded as in." : "Every record that day was closed."}
        names={names(board.inNow)}
      >
        {board.inNow.map((person) => (
          <PersonRow
            key={person.id}
            name={person.name}
            head={head(person)}
            glance={
              person.olderDay ? (
                <>In since {formatIsoDate(person.arrivedOn)} · still open{corrected(person)}</>
              ) : (
                <>
                  In {timeLabel(person.clockInAt)} · <Duration since={person.clockInAt.toISOString()} asOf={asOf} />
                  {corrected(person)}
                </>
              )
            }
          >
            {fact("In at", timeLabel(person.clockInAt))}
            {person.olderDay ? (
              <p className={styles.fact}>
                <span className={styles.factLabel}>Open since</span>
                <span className={styles.older}>{formatLongDate(person.arrivedOn)}</span>
              </p>
            ) : (
              fact("Here for", <Duration since={person.clockInAt.toISOString()} asOf={asOf} />)
            )}
            {actions(person, "in")}
            {note(person)}
            {movementsBlock(person)}
          </PersonRow>
        ))}
      </Section>

      <Section
        id="out-heading"
        title="Out on a movement"
        count={board.counts.out}
        empty="Nobody is out on a movement. Use Out… on a person who is in."
        names={names(board.outNow)}
      >
        {board.outNow.map((person) => (
          <PersonRow
            key={person.id}
            name={person.name}
            head={head(person)}
            glance={
              <>
                Out: {person.movement!.destination} · since {timeLabel(person.movement!.leftAt)}
                {person.movement!.selfApproved ? " · Self-approved" : ""}
                {corrected(person)}
              </>
            }
          >
            {fact("Left at", timeLabel(person.movement!.leftAt))}
            {fact("Gone to", `${person.movement!.destination} · ${person.movement!.purpose}`)}
            {fact("Gone for", <Duration since={person.movement!.leftAt.toISOString()} asOf={asOf} />)}
            {actions(person, "out")}
            {note(person)}
            {movementsBlock(person)}
          </PersonRow>
        ))}
      </Section>

      <Section
        id="gone-heading"
        title="Gone for the day"
        count={board.counts.gone}
        empty={isToday ? "Nobody has been clocked out yet today." : "Nobody was clocked out that day."}
        names={names(board.gone)}
      >
        {board.gone.map((person) => (
          <PersonRow
            key={person.id}
            name={person.name}
            head={head(person)}
            glance={
              <>
                {timeLabel(person.clockInAt)} to {timeLabel(person.clockOutAt!)} · {formatDuration(person.clockOutAt!.getTime() - person.clockInAt.getTime())}
                {corrected(person)}
              </>
            }
          >
            {fact("In", timeLabel(person.clockInAt))}
            {fact("Out", timeLabel(person.clockOutAt!))}
            {fact("Time", formatDuration(person.clockOutAt!.getTime() - person.clockInAt.getTime()))}
            {actions(person, "gone")}
            {note(person)}
            {movementsBlock(person)}
          </PersonRow>
        ))}
      </Section>

      <Section
        id="nosignout-heading"
        title="No sign-out"
        count={board.counts.noSignout}
        empty={isToday ? "Nobody has been marked as not signed out today." : "Nobody was marked as not signed out that day."}
        names={names(board.noSignout)}
      >
        {board.noSignout.map((person) => (
          <PersonRow
            key={person.id}
            name={person.name}
            head={head(person)}
            glance={
              <>
                In {timeLabel(person.clockInAt)} · no sign-out, hours unknown{corrected(person)}
              </>
            }
          >
            {fact("In", timeLabel(person.clockInAt))}
            {fact("Out", "no time recorded")}
            <p className={styles.fact}>
              <StatusPill tone="amber">No sign-out</StatusPill>
              <span className={styles.unknown}>Hours unknown</span>
            </p>
            {actions(person, "nosignout")}
            {note(person)}
            {movementsBlock(person)}
          </PersonRow>
        ))}
      </Section>

      {board.removed.length > 0 ? (
        <Section id="removed-heading" title="Removed records" count={board.removed.length} empty="" names={names(board.removed)}>
          {board.removed.map((person) => (
            <PersonRow key={person.id} name={person.name} head={head(person)} glance={<>Removed · was in at {timeLabel(person.clockInAt)}</>}>
              {fact("Was in at", timeLabel(person.clockInAt))}
              {fact("Removed", person.voidedAt ? timeLabel(person.voidedAt) : "")}
              {actions(person, "removed")}
              {note(person, true)}
            </PersonRow>
          ))}
        </Section>
      ) : null}

      {isToday ? <EndOfDay people={board.inNow.map((person) => ({ id: person.id, name: person.name }))} /> : null}
    </div>
    </BoardFilterProvider>
    </BoardDataProvider>
  );
}
