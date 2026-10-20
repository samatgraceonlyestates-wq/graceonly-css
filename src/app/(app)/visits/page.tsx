import type { Metadata } from "next";
import { Button } from "@/components/Button/Button";
import { Card } from "@/components/Card/Card";
import { Chip } from "@/components/Chip/Chip";
import { ElapsedTime } from "@/components/ElapsedTime/ElapsedTime";
import { FilterChips } from "@/components/FilterChips/FilterChips";
import { PageHeader } from "@/components/PageHeader/PageHeader";
import { PersonCell } from "@/components/PersonCell/PersonCell";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from "@/components/Table/Table";
import { VisitStatus } from "@/components/VisitStatus/VisitStatus";
import { VisuallyHidden } from "@/components/VisuallyHidden/VisuallyHidden";
import { requireSession } from "@/lib/auth";
import { getClockParts } from "@/lib/format";
import { getVisitsSample } from "@/lib/sampleData";
import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "Active visits — CSS",
};

// Live front-desk state: render per request, never at build time.
export const dynamic = "force-dynamic";

const GROUPS = [
  { label: "Clients", kind: "Client" },
  { label: "Realtors", kind: "Realtor" },
  { label: "Investors", kind: "Investor" },
  { label: "Deliveries", kind: "Delivery" },
] as const;

export default async function VisitsPage() {
  await requireSession();
  const now = new Date();
  const asOf = now.toISOString();
  const visits = getVisitsSample(now);

  // Counts come from the visits themselves, so the chips always add up.
  const chips = [
    { label: "All", count: visits.length, selected: true },
    ...GROUPS.map((group) => ({
      label: group.label,
      count: visits.filter((visit) => visit.kind === group.kind).length,
    })),
  ];

  return (
    <div className={styles.page}>
      <PageHeader
        eyebrow={
          <>
            <span className={styles.desktopInline}>Live · {visits.length} currently in building</span>
            <span className={styles.mobileInline}>Live · {visits.length} in building</span>
          </>
        }
        title="Active visits"
      />

      <FilterChips label="Visits in the building, by type" items={chips} />

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
              <TableHeaderCell width="88px">
                <VisuallyHidden>Actions</VisuallyHidden>
              </TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {visits.map((visit) => {
              const clock = getClockParts(new Date(visit.checkInAt));
              const kindAndDetail = visit.detail ? `${visit.kind} · ${visit.detail}` : visit.kind;

              return (
                <TableRow key={visit.id} className={styles.row}>
                  <TableCell className={styles.cellPerson}>
                    {/* One instance per row: size and sub line change by CSS variable. */}
                    <PersonCell
                      className={styles.person}
                      name={visit.name}
                      size="responsive"
                      sub={kindAndDetail}
                    />
                  </TableCell>
                  <TableCell hideOnMobile>{kindAndDetail}</TableCell>
                  <TableCell className={styles.cellChip}>
                    <Chip>
                      <span className={styles.desktopInline}>{visit.reasonLong ?? visit.reason}</span>
                      <span className={styles.mobileInline}>{visit.reason}</span>
                    </Chip>
                  </TableCell>
                  <TableCell className={styles.cellWhen}>
                    <span className={styles.desktopInline}>{clock.time12}</span>
                    <span className={styles.mobileInline}>In at {clock.time24}</span>
                  </TableCell>
                  <TableCell className={styles.cellTime}>
                    <ElapsedTime checkInAt={visit.checkInAt} asOf={asOf} />
                  </TableCell>
                  <TableCell hideOnMobile>
                    <VisitStatus checkInAt={visit.checkInAt} asOf={asOf} />
                  </TableCell>
                  <TableCell className={styles.cellAction}>
                    {/* TODO: Check out has no backend yet. Rendered enabled, wired to
                        nothing, the same way the login form posts to nothing. */}
                    <Button variant="row-action">Check out</Button>
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
