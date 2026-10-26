// Screen 02, the dashboard (Figma 24:2 / 24:125). EVERY NUMBER HERE IS REAL OR SAYS IT IS
// MISSING: no invented figure on a screen someone will read as fact.
//  - Visits today and Active now are counted by the database from real visits (removed
//    ones never count). "vs yesterday" deltas are NOT shown: today is a part-day, yesterday
//    a whole one, and a percentage between them would mislead. Yesterday's total is given
//    as a plain caption instead.
//  - Docs released counts today's document HANDOVERS (not withdrawn) and says how many nobody
//    verified (recorded while the portal's gate was off or it could not answer).
//  - Open complaints has NO source yet (the portal's case endpoints are being built), so its
//    tile shows a dash and says so. The complaints panel says the same instead of sample cases.
import type { Metadata } from "next";
import Link from "next/link";
import { Card } from "@/components/Card/Card";
import { Chip } from "@/components/Chip/Chip";
import { ElapsedTime } from "@/components/ElapsedTime/ElapsedTime";
import { Notice } from "@/components/Notice/Notice";
import { PageHeader } from "@/components/PageHeader/PageHeader";
import { PersonCell } from "@/components/PersonCell/PersonCell";
import { StatTile } from "@/components/StatTile/StatTile";
import { requireSession } from "@/lib/auth";
import { firstName, formatIsoDate, getClockParts, greetingForHour } from "@/lib/format";
import { lagosDateOf } from "@/lib/lagosTime";
import { reasonLabel, typeLabel } from "@/lib/visits";
import { loadOpenVisits, loadVisitCounts } from "@/lib/visitStore";
import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "Dashboard — CSS",
};

// Live front-desk state: render per request, never at build time.
export const dynamic = "force-dynamic";

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

export default async function DashboardPage() {
  const user = await requireSession();
  const now = new Date();
  const asOf = now.toISOString();
  const clock = getClockParts(now);
  const today = lagosDateOf(now);
  const [counts, open] = await Promise.all([loadVisitCounts(now), loadOpenVisits(5)]);

  return (
    <div className={styles.page}>
      <PageHeader
        eyebrow={
          <>
            <span className={styles.desktopOnly}>
              {clock.weekdayLong} · {clock.day} {clock.month} · {clock.time12}
            </span>
            <span className={styles.mobileOnly}>
              {clock.weekdayShort} · {clock.day} {clock.month} · {clock.time24}
            </span>
          </>
        }
        title={`${greetingForHour(clock.hour)}, ${firstName(user.fullName)}.`}
        lede={`${plural(counts.today, "visitor", "visitors")} in today, ${counts.inBuilding} in the building now.`}
        ledeHiddenOnMobile
      />

      <section className={styles.kpis} aria-label="Today at a glance">
        <StatTile label="Visits today" shortLabel="Today" value={counts.today} caption={`Yesterday: ${counts.yesterday} in all`} />
        <StatTile
          label="Active now"
          shortLabel="Active"
          value={counts.inBuilding}
          caption={counts.inBuildingFromEarlier > 0 ? `${counts.inBuildingFromEarlier} open from an earlier day` : "In the building"}
        />
        <StatTile label="Open complaints" shortLabel="Open" value="—" caption="Not connected yet" />
        <StatTile
          label="Docs released"
          value={counts.handoversToday}
          caption={counts.handoversUnverified > 0 ? `${counts.handoversUnverified} not verified by the portal` : "Handovers recorded today"}
          desktopOnly
        />
      </section>

      <div className={styles.panels}>
        <Card as="section" aria-labelledby="active-visits-heading" plainOnMobile className={styles.panel}>
          <div className={styles.panelHeader}>
            <h2 id="active-visits-heading" className={styles.panelTitle}>
              Active visits
            </h2>
            <Link href="/visits" className={styles.panelLink}>
              <span className={styles.desktopOnly}>View all →</span>
              <span className={styles.mobileOnly}>All →</span>
            </Link>
          </div>

          {open.length === 0 ? (
            <p className={styles.empty}>Nobody is checked in right now.</p>
          ) : (
            <ul className={styles.list}>
              {open.map((visit) => {
                const older = lagosDateOf(visit.checkedInAt) !== today;
                return (
                  <li key={visit.id} className={styles.row}>
                    <Link href={`/visits/${visit.id}`} className={styles.visitLink}>
                      <PersonCell
                        className={styles.visitPerson}
                        name={visit.name}
                        sub={
                          <>
                            <span className={styles.desktopOnly}>
                              {typeLabel(visit.visitorTypeCode)}
                              {visit.lookupOutcome === "PORTAL_UNAVAILABLE" ? " · not verified" : ""}
                            </span>
                            <span className={styles.mobileOnly}>
                              {typeLabel(visit.visitorTypeCode)} · {reasonLabel(visit.reasonCode)}
                            </span>
                          </>
                        }
                      />
                    </Link>
                    <Chip className={styles.visitChip}>{reasonLabel(visit.reasonCode)}</Chip>
                    {older ? (
                      <span className={styles.older}>Since {formatIsoDate(lagosDateOf(visit.checkedInAt))}</span>
                    ) : (
                      <ElapsedTime checkInAt={visit.checkedInAt.toISOString()} asOf={asOf} />
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          {counts.inBuilding > open.length ? (
            <p className={styles.more}>
              {counts.inBuilding - open.length} more in the building. <Link href="/visits">See them all.</Link>
            </p>
          ) : null}
        </Card>

        <Card as="section" aria-labelledby="open-complaints-heading" plainOnMobile className={styles.panel}>
          <div className={styles.panelHeader}>
            <h2 id="open-complaints-heading" className={styles.panelTitle}>
              Open complaints
            </h2>
          </div>
          <Notice tone="guidance" title="Not connected yet" role="status">
            <p>
              Complaints belong to the client portal, which does not offer them to CSS yet, so none can be shown here. Nothing on
              this panel is a count of real complaints.
            </p>
          </Notice>
        </Card>
      </div>
    </div>
  );
}
