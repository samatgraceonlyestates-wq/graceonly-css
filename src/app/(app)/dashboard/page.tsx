import type { Metadata } from "next";
import Link from "next/link";
import { Card } from "@/components/Card/Card";
import { Chip } from "@/components/Chip/Chip";
import { ComplaintAge } from "@/components/ComplaintAge/ComplaintAge";
import { ElapsedTime } from "@/components/ElapsedTime/ElapsedTime";
import { PageHeader } from "@/components/PageHeader/PageHeader";
import { PersonCell } from "@/components/PersonCell/PersonCell";
import { StatTile } from "@/components/StatTile/StatTile";
import { StatusPill } from "@/components/StatusPill/StatusPill";
import { cx } from "@/lib/cx";
import { getClockParts, greetingForHour } from "@/lib/format";
import { getDashboardSample } from "@/lib/sampleData";
import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "Dashboard — CSS",
};

// Live front-desk state: render per request, never at build time.
export const dynamic = "force-dynamic";

export default function DashboardPage() {
  const now = new Date();
  const { asOf, user, stats, visits, complaints } = getDashboardSample(now);
  const clock = getClockParts(now);

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
        title={`${greetingForHour(clock.hour)}, ${user.name}.`}
        lede={`${stats.visitsToday.value} visitors in today. ${stats.openComplaints.value} complaints need admin eyes.`}
        ledeHiddenOnMobile
      />

      <section className={styles.kpis} aria-label="Today at a glance">
        <StatTile
          label="Visits today"
          shortLabel="Today"
          value={stats.visitsToday.value}
          delta={stats.visitsToday.delta}
          comparison="vs yesterday"
        />
        <StatTile
          label="Active now"
          shortLabel="Active"
          value={stats.activeNow.value}
          delta={stats.activeNow.delta}
          comparison="vs yesterday"
        />
        <StatTile
          label="Open complaints"
          shortLabel="Open"
          value={stats.openComplaints.value}
          delta={stats.openComplaints.delta}
          comparison="vs yesterday"
        />
        <StatTile
          label="Docs released"
          value={stats.docsReleased.value}
          delta={stats.docsReleased.delta}
          comparison="vs yesterday"
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

          <ul className={styles.list}>
            {visits.map((visit) => (
              <li key={visit.id} className={styles.row}>
                <PersonCell
                  className={styles.visitPerson}
                  name={visit.name}
                  sub={
                    <>
                      <span className={styles.desktopOnly}>
                        {visit.detail ? `${visit.kind} · ${visit.detail}` : visit.kind}
                      </span>
                      <span className={styles.mobileOnly}>
                        {visit.kind} · {visit.reason}
                      </span>
                    </>
                  }
                />
                <Chip className={styles.visitChip}>{visit.reason}</Chip>
                <ElapsedTime checkInAt={visit.checkInAt} asOf={asOf} />
              </li>
            ))}
          </ul>
        </Card>

        <Card as="section" aria-labelledby="open-complaints-heading" plainOnMobile className={styles.panel}>
          <div className={styles.panelHeader}>
            <h2 id="open-complaints-heading" className={styles.panelTitle}>
              Open complaints
            </h2>
            <StatusPill tone="red">{stats.openComplaints.value} open</StatusPill>
          </div>

          <ul className={styles.list}>
            {complaints.map((complaint) => (
              <li key={complaint.id} className={cx(styles.row, styles.complaint)}>
                <div className={styles.complaintTop}>
                  <span className={styles.complaintTitle}>{complaint.title}</span>
                  <ComplaintAge raisedAt={complaint.raisedAt} asOf={asOf} className={styles.age} />
                </div>
                <p className={styles.complaintMeta}>
                  {complaint.raisedBy} · {complaint.team}
                </p>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}
