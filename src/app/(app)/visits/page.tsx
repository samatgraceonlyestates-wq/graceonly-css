// Screen 03, Active visits (Figma 26:2 / 26:147), on REAL visits (visitStore.ts, grouped in
// visitLog.ts). The table is who is IN THE BUILDING now: checked in and not checked out,
// including a visit left open from an earlier day ("Open since ..."), which is a forgotten
// check-out and stays in front of the desk until somebody closes it. Below the designed table,
// UNDESIGNED and built from shared components only: who LEFT today, visits REMOVED (a void,
// restorable from the visit), and the END OF DAY panel that closes what is still open.
//
// Any earlier day can be shown (?day=YYYY-MM-DD) to find and correct its visits. A visit that
// was corrected says so in its row; a visit checked in while the portal was down says "not
// verified". Counts are derived from the rows, never stored. A removed visit counts nowhere.
import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/Button/Button";
import { Card } from "@/components/Card/Card";
import { Chip } from "@/components/Chip/Chip";
import { ElapsedTime } from "@/components/ElapsedTime/ElapsedTime";
import { FilterChips } from "@/components/FilterChips/FilterChips";
import { PageHeader } from "@/components/PageHeader/PageHeader";
import { PersonCell } from "@/components/PersonCell/PersonCell";
import { StatusPill } from "@/components/StatusPill/StatusPill";
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/Table/Table";
import { VisitStatus } from "@/components/VisitStatus/VisitStatus";
import { VisuallyHidden } from "@/components/VisuallyHidden/VisuallyHidden";
import { requireSession } from "@/lib/auth";
import { timeLabel } from "@/lib/departureTime";
import { formatDuration, formatIsoDate, formatLongDate, getClockParts } from "@/lib/format";
import { lagosDateOf, pastOrToday } from "@/lib/lagosTime";
import type { VisitEntry } from "@/lib/visitLog";
import { reasonLabel, typeLabel, VISITOR_TYPES } from "@/lib/visits";
import { loadVisitDay } from "@/lib/visitStore";
import { CloseDay } from "./CloseDay";
import { RowCheckOut } from "./RowCheckOut";
import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "Active visits — CSS",
};

// Live front-desk state: render per request, never at build time.
export const dynamic = "force-dynamic";

const PLURAL: Record<string, string> = { CLIENT: "Clients", REALTOR: "Realtors", INVESTOR: "Investors", DELIVERY: "Deliveries", VISITOR: "Visitors" };
// The chip's short label on a phone (the full one on desktop).
const REASON_SHORT: Record<string, string> = { DOCUMENT_COLLECTION: "Documents", CONTRACT_SIGNING: "Contract", SCHEDULED_MEETING: "Meeting" };

/** "Client · Acme Ltd · not verified · corrected": what kind of visit, and anything a reader must not miss. */
function kindLine(visit: VisitEntry): string {
  return [
    typeLabel(visit.visitorTypeCode),
    visit.organisation,
    visit.lookupOutcome === "PORTAL_UNAVAILABLE" ? "not verified" : null,
    visit.correctedAt !== null ? "corrected" : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

export default async function VisitsPage({ searchParams }: { searchParams: Promise<{ day?: string | string[] }> }) {
  await requireSession();
  const now = new Date();
  const asOf = now.toISOString();
  const today = lagosDateOf(now);
  const day = pastOrToday((await searchParams).day, today);
  const log = await loadVisitDay(day, now);
  const { isToday } = log;

  // Counts come from the visits themselves, so the chips always add up.
  const chips = [
    { label: "All", count: log.counts.inBuilding, selected: true },
    ...VISITOR_TYPES.map((type) => ({ label: PLURAL[type.code] ?? type.label, count: log.inBuildingByType[type.code] ?? 0 })),
  ];

  const correctedNote = (visit: VisitEntry, removed = false) =>
    visit.correctedAt !== null ? (
      <p className={styles.note}>
        <StatusPill tone="steel">{removed ? "Removed" : "Corrected"}</StatusPill>
        <span>
          {removed ? "Removed" : "Changed"} at {timeLabel(visit.correctedAt)}
          {lagosDateOf(visit.correctedAt) === day ? "" : `, ${formatIsoDate(lagosDateOf(visit.correctedAt))}`} by{" "}
          {visit.correctedByName ?? "someone"}: <q>{visit.correctionReason}</q>
        </span>
      </p>
    ) : null;

  // In the table the Type column carries the sub line on desktop; in the lists below it is always shown.
  const person = (visit: VisitEntry, sub: string, inTable = false) => (
    <Link href={`/visits/${visit.id}`} className={styles.personLink}>
      <PersonCell className={inTable ? styles.person : styles.listPerson} name={visit.name} size={inTable ? "responsive" : 36} sub={sub} />
    </Link>
  );

  return (
    <div className={styles.page}>
      <PageHeader
        eyebrow={
          isToday ? (
            <>
              <span className={styles.desktopInline}>Live · {log.counts.inBuilding} currently in building</span>
              <span className={styles.mobileInline}>Live · {log.counts.inBuilding} in building</span>
            </>
          ) : (
            "An earlier day"
          )
        }
        title={isToday ? "Active visits" : "Visits"}
        lede={isToday ? undefined : formatLongDate(day)}
        ledeSize="sm"
      />

      {/* Look at another day (to find and correct its visits). A plain GET form. */}
      <form method="get" action="/visits" className={styles.dayForm}>
        <label className={styles.dayLabel} htmlFor="visits-day">
          Day
        </label>
        <input id="visits-day" className={styles.dayInput} type="date" name="day" max={today} defaultValue={day} />
        <Button type="submit" variant="row-action">
          Show
        </Button>
        {!isToday ? (
          <Button href="/visits" variant="row-action">
            Back to today
          </Button>
        ) : null}
        <span className={styles.dayLong}>
          {formatLongDate(day)} · {log.counts.visits} {log.counts.visits === 1 ? "visit" : "visits"}
        </span>
      </form>

      <FilterChips label="Visits in the building, by type" items={chips} />

      {log.inBuilding.length === 0 ? (
        <Card padding="md" className={styles.section}>
          <p className={styles.empty}>
            {isToday ? "Nobody is checked in right now. Use + New visit when someone arrives." : "No visit from that day is still open."}
          </p>
        </Card>
      ) : (
        <Card padding="table" plainOnMobile>
          <Table>
            <TableHead>
              <TableRow>
                <TableHeaderCell width="276px">Visitor</TableHeaderCell>
                <TableHeaderCell width="196px">Type</TableHeaderCell>
                <TableHeaderCell width="196px">Reason</TableHeaderCell>
                <TableHeaderCell width="126px">Check-in</TableHeaderCell>
                <TableHeaderCell width="116px">Elapsed</TableHeaderCell>
                <TableHeaderCell>Status</TableHeaderCell>
                <TableHeaderCell width="120px">
                  <VisuallyHidden>Actions</VisuallyHidden>
                </TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {log.inBuilding.map((visit) => {
                const clock = getClockParts(visit.checkedInAt);
                const kind = kindLine(visit);
                const since = formatIsoDate(lagosDateOf(visit.checkedInAt));
                return (
                  <TableRow key={visit.id} className={styles.row}>
                    <TableCell className={styles.cellPerson}>{person(visit, kind, true)}</TableCell>
                    <TableCell hideOnMobile>{kind}</TableCell>
                    <TableCell className={styles.cellChip}>
                      <Chip>
                        <span className={styles.desktopInline}>{reasonLabel(visit.reasonCode)}</span>
                        <span className={styles.mobileInline}>{REASON_SHORT[visit.reasonCode] ?? reasonLabel(visit.reasonCode)}</span>
                      </Chip>
                    </TableCell>
                    <TableCell className={styles.cellWhen}>
                      {visit.olderDay ? (
                        <span className={styles.older}>Since {since}</span>
                      ) : (
                        <>
                          <span className={styles.desktopInline}>{clock.time12}</span>
                          <span className={styles.mobileInline}>In at {clock.time24}</span>
                        </>
                      )}
                    </TableCell>
                    <TableCell className={styles.cellTime}>
                      {visit.olderDay ? <span className={styles.older}>Not checked out</span> : <ElapsedTime checkInAt={visit.checkedInAt.toISOString()} asOf={asOf} />}
                    </TableCell>
                    <TableCell hideOnMobile>
                      {visit.olderDay ? <StatusPill tone="red">Still open</StatusPill> : <VisitStatus checkInAt={visit.checkedInAt.toISOString()} asOf={asOf} />}
                    </TableCell>
                    <TableCell className={styles.cellAction}>
                      <RowCheckOut visitId={visit.id} name={visit.name} />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Card>
      )}

      <Card as="section" padding="md" aria-labelledby="left-heading" className={styles.section}>
        <h2 id="left-heading" className={styles.sectionTitle}>
          {isToday ? "Left today" : "Left"} <span className={styles.sectionCount}>{log.counts.left}</span>
        </h2>
        {log.left.length === 0 ? (
          <p className={styles.empty}>{isToday ? "Nobody has been checked out yet today." : "Nobody was checked out that day."}</p>
        ) : (
          <ul className={styles.list}>
            {log.left.map((visit) => (
              <li key={visit.id} className={styles.item}>
                {person(visit, `${kindLine(visit)} · ${reasonLabel(visit.reasonCode)}`)}
                <p className={styles.facts}>
                  {visit.lengthMs === null ? (
                    <>
                      In {timeLabel(visit.checkedInAt)} · <span className={styles.unknown}>left: not recorded</span> (closed at the end
                      of the day by {visit.checkedOutByName ?? "someone"})
                    </>
                  ) : (
                    <>
                      {timeLabel(visit.checkedInAt)} to {timeLabel(visit.checkedOutAt!)} · {formatDuration(visit.lengthMs)} · checked
                      out by {visit.checkedOutByName ?? "someone"}
                    </>
                  )}
                </p>
                {correctedNote(visit)}
              </li>
            ))}
          </ul>
        )}
        {log.counts.leftUnknown > 0 ? (
          <p className={styles.sectionNote}>
            {log.counts.leftUnknown} {log.counts.leftUnknown === 1 ? "visit was" : "visits were"} closed at the end of the day: when
            they left is unknown, so no length is shown for {log.counts.leftUnknown === 1 ? "it" : "them"}.
          </p>
        ) : null}
      </Card>

      {log.removed.length > 0 ? (
        <Card as="section" padding="md" aria-labelledby="removed-heading" className={styles.section}>
          <h2 id="removed-heading" className={styles.sectionTitle}>
            Removed visits <span className={styles.sectionCount}>{log.counts.removed}</span>
          </h2>
          <p className={styles.sectionNote}>These count for nothing. Open one to restore it.</p>
          <ul className={styles.list}>
            {log.removed.map((visit) => (
              <li key={visit.id} className={styles.item}>
                {person(visit, `Was in at ${timeLabel(visit.checkedInAt)} · ${typeLabel(visit.visitorTypeCode)}`)}
                {correctedNote(visit, true)}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {isToday ? <CloseDay visits={log.inBuilding.map((visit) => ({ id: visit.id, name: visit.name }))} /> : null}
    </div>
  );
}
