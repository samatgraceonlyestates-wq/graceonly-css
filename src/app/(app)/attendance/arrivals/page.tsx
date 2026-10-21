// UNDESIGNED: this screen is not in Figma. It is built from the shared components
// and tokens only, and should be replaced when a design exists.
//
// The front desk copies the paper attendance book into CSS here, in a batch (see
// CLAUDE.md, "ATTENDANCE: HOW IT REALLY WORKS"). Gated on the server by
// requireAnyRole before the roster is loaded; the save action gates itself again.
import type { Metadata } from "next";
import { Notice } from "@/components/Notice/Notice";
import { PageHeader } from "@/components/PageHeader/PageHeader";
import { ARRIVAL_ROLES } from "@/lib/arrivalBatch";
import { loadArrivalRoster } from "@/lib/arrivalStore";
import { requireAnyRole } from "@/lib/auth";
import { lagosDateOf } from "@/lib/lagosTime";
import { ArrivalsForm } from "./ArrivalsForm";
import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "Enter arrivals — CSS",
};

// Live data: render per request, never at build time.
export const dynamic = "force-dynamic";

export default async function ArrivalsPage() {
  const { allowed } = await requireAnyRole(ARRIVAL_ROLES);
  if (!allowed) {
    return (
      <Notice tone="limited" title="Front desk only" role="status">
        <p>Attendance is entered by the front desk. If you need to, ask an administrator to give you the role.</p>
      </Notice>
    );
  }

  // The whole roster: 20 to 30 people. Suggestions and the duplicate check run in
  // the browser over this list, and again on the server when the page is saved.
  const roster = await loadArrivalRoster();
  const today = lagosDateOf(new Date());

  return (
    <div className={styles.page}>
      <PageHeader
        eyebrow="Staff · Attendance"
        title="Enter arrivals"
        lede="Copy the paper book: a name and the time in, one person to a row. Enter or Tab moves on. Nothing is saved until you press Save, and if any row has a problem nothing is saved."
        ledeSize="sm"
      />
      <ArrivalsForm roster={roster} today={today} />
    </div>
  );
}
