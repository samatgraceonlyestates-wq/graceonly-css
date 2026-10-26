// UNVERIFIED AGAINST FIGMA. Screen 05 (nodes 28:2 / 28:80) was built from a
// written description of the frames, not from the frames themselves: the Figma
// MCP quota was spent. See Panels.tsx for what to check.
//
// [id] is a VISIT id: the visit comes from CSS's own log (visitStore.ts). For a client the
// screen also reads the portal LIVE (loadVisitDetail, by the visit's portal_client_id): if the
// portal fails, the visit itself is still shown, with the failure said where the client data
// would be. The visit never depends on the portal.
//
// Decisions that are not in the frame (see CLAUDE.md):
//  - NO phone number and NO "Client ID #GW-00412" for a client: neither exists. The meta
//    line is kind, estate and purchase label only. A NON-client's phone is CSS's own record
//    and is shown in "About the visit".
//  - The name at the top is the portal's LIVE name; the name AS LOGGED at the desk
//    (client_name_logged, never refreshed) is shown beside it when they differ.
//  - "Payment status" is retitled "Documentation fee". The portal refuses
//    property balance, last receipt and payment history on purpose; the fee is
//    the only money CSS may show.
//  - "Documents today" is retitled "Issued by the portal": what EXISTS, not a release
//    decision. The release position has its own banner.
//  - UNDESIGNED: DOCUMENT HANDOVERS (HandoverCard, handovers.ts) live here, on the visit that
//    produced them, not in a documents section of their own. Silence is not permission: the
//    card never says a document may be handed over; the portal is asked again on every save.
//  - UNDESIGNED: the lookup outcome (a visit checked in while the portal was down says NOT
//    VERIFIED), the corrections card, the removed state and the real timeline.
import type { Metadata } from "next";
import Link from "next/link";
import { Avatar } from "@/components/Avatar/Avatar";
import { Card } from "@/components/Card/Card";
import { ElapsedTime } from "@/components/ElapsedTime/ElapsedTime";
import { Notice } from "@/components/Notice/Notice";
import { StatusPill } from "@/components/StatusPill/StatusPill";
import { requireSession } from "@/lib/auth";
import { timeLabel } from "@/lib/departureTime";
import { formatDuration, formatIsoDate } from "@/lib/format";
import { lagosDateOf } from "@/lib/lagosTime";
import { loadHandovers } from "@/lib/handoverStore";
import { formatPhone } from "@/lib/phoneNumber";
import { loadVisitDetail } from "@/lib/visitDetail";
import { lengthOf } from "@/lib/visitLog";
import { isUuid, LOOKUP_TEXT, reasonLabel, typeLabel } from "@/lib/visits";
import { loadVisit, type VisitDetail } from "@/lib/visitStore";
import { CheckOutAction } from "./CheckOutAction";
import { HandoverCard, type HandoverCardRow } from "./HandoverCard";
import { DocumentsPanel, FeePanel, ReleaseBanner, Timeline, type TimelineEntry } from "./Panels";
import { VisitCorrect, type VisitState } from "./VisitCorrect";
import styles from "./page.module.css";

// No visitor or client name in the title: it would put it in the tab and history.
export const metadata: Metadata = {
  title: "Visit — CSS",
};

// Reads the database and the portal per request: never render at build time, never cache.
export const dynamic = "force-dynamic";

const CORRECTION_TEXT: Record<string, string> = {
  checkin: "Check-in time changed",
  checkout: "Check-out time changed",
  reopen: "Reopened: check-out undone",
  reason: "Reason changed",
  toSee: "Who they came to see changed",
  type: "Visitor type changed",
  name: "Name corrected",
  phone: "Phone corrected",
  void: "Visit removed",
  restore: "Visit restored",
};

/** "10:12", or "10:12, 23 Oct 2026" when it is not on the visit's own day. */
function when(at: Date, visitDay: string): string {
  const day = lagosDateOf(at);
  return day === visitDay ? timeLabel(at) : `${timeLabel(at)}, ${formatIsoDate(day)}`;
}

function timeline(visit: VisitDetail): TimelineEntry[] {
  const day = lagosDateOf(visit.checkedInAt);
  const entries: TimelineEntry[] = [
    {
      id: "checked-in",
      title: "Checked in",
      detail: `By ${visit.checkedInByName ?? "someone"} · ${reasonLabel(visit.reasonCode)} · ${LOOKUP_TEXT[visit.lookupOutcome]}`,
      at: visit.checkedInAt.toISOString(),
    },
  ];
  let closeSeen = false;
  visit.history.forEach((entry, index) => {
    // The time column shows a time of day: say the day when it is not the visit's own.
    const by = `${entry.actorName ?? "someone"}${lagosDateOf(entry.at) === day ? "" : ` on ${formatIsoDate(lagosDateOf(entry.at))}`}`;
    if (entry.via === "check-out") {
      closeSeen = true;
      entries.push({ id: `h${index}`, title: "Checked out", detail: `By ${by}`, at: entry.at.toISOString() });
    } else if (entry.via === "end of day") {
      closeSeen = true;
      entries.push({ id: `h${index}`, title: "Closed at the end of the day", detail: `By ${by}. When they left was not recorded.`, at: entry.at.toISOString(), flagged: true });
    } else if (entry.via === "correction") {
      entries.push({
        id: `h${index}`,
        title: CORRECTION_TEXT[entry.correction ?? ""] ?? "Corrected",
        detail: `By ${by}: “${entry.correctionReason ?? ""}”`,
        at: entry.at.toISOString(),
        flagged: true,
      });
    }
  });
  // A visit closed with no audit row of its own (written outside the app): still shown.
  if (visit.checkedOutAt !== null && !closeSeen) {
    entries.push({ id: "checked-out", title: visit.closeReason === "AUTO_CLOSED" ? "Closed at the end of the day" : "Checked out", detail: `By ${visit.checkedOutByName ?? "someone"}`, at: visit.checkedOutAt.toISOString() });
  }
  return entries.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
}

export default async function VisitDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ checked?: string }>;
}) {
  // The session first: nothing is read for someone who is not in.
  await requireSession();
  const { id } = await params;
  const visit = isUuid(id) ? await loadVisit(id) : null;

  if (visit === null) {
    return (
      <div className={styles.page}>
        <Notice tone="guidance" title="Visit not found" role="status">
          <p>
            There is no such visit. <Link href="/visits">Go back to the visit list.</Link>
          </p>
        </Notice>
      </div>
    );
  }

  const now = new Date();
  const asOf = now.toISOString();
  const justCheckedIn = (await searchParams).checked === "in";
  // A client's live record, from the portal. A failure here never hides the visit.
  const [portal, handovers] = await Promise.all([visit.clientId !== null ? loadVisitDetail(visit.clientId) : null, loadHandovers(visit.id)]);
  const live = portal?.kind === "loaded" ? portal.summary : null;
  const handoverRows: HandoverCardRow[] = handovers.map((handover) => ({
    id: handover.id,
    releasedAt: handover.releasedAt.toISOString(),
    releasedByName: handover.releasedByName,
    purchaseId: handover.purchaseId,
    gateAnswer: handover.gateAnswer,
    gateRequestId: handover.gateRequestId,
    note: handover.note,
    items: handover.items,
    correction: handover.correction
      ? { reason: handover.correction.reason, correctedAt: handover.correction.correctedAt.toISOString(), correctedByName: handover.correction.correctedByName }
      : null,
    replacedBy: handover.replacedBy ? { id: handover.replacedBy.id, releasedAt: handover.replacedBy.releasedAt.toISOString() } : null,
    replaces: handover.replaces ? { id: handover.replaces.id, releasedAt: handover.replaces.releasedAt.toISOString(), reason: handover.replaces.reason } : null,
  }));

  const day = lagosDateOf(visit.checkedInAt);
  const olderDay = day !== lagosDateOf(now);
  const state: VisitState =
    visit.voidedAt !== null ? "removed" : visit.checkedOutAt === null ? "open" : visit.closeReason === "AUTO_CLOSED" ? "auto" : "closed";
  const length = lengthOf(visit);

  const displayName = live?.displayName ?? visit.name;
  const [first, ...more] = live?.purchases ?? [];
  const meta = [
    typeLabel(visit.visitorTypeCode),
    first?.estateName,
    first ? `${first.label}${more.length > 0 ? ` +${more.length} more` : ""}` : null,
    reasonLabel(visit.reasonCode),
    visit.toSee ? `to see ${visit.toSee}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className={styles.page}>
      {justCheckedIn && state === "open" ? (
        <Notice tone="info" title="Checked in" role="status">
          <p>
            {visit.name} was checked in at {timeLabel(visit.checkedInAt)}. <Link href="/visits/new">Check in someone else</Link> or{" "}
            <Link href="/visits">see who is in</Link>.
          </p>
        </Notice>
      ) : null}

      <Card as="section" aria-labelledby="client-name" padding="lg" className={styles.header}>
        <div className={styles.avatar}>
          <Avatar name={displayName} size="responsive" tone="solid" />
        </div>
        <div className={styles.identity}>
          <h1 id="client-name" className={styles.name}>
            {displayName}
          </h1>
          <p className={styles.meta}>{meta}</p>
          {live !== null && live.displayName !== visit.name ? <p className={styles.meta}>Logged at the desk as {visit.name}</p> : null}
        </div>
        <div className={styles.timer}>
          {state === "removed" ? (
            <StatusPill tone="steel">Removed</StatusPill>
          ) : state === "open" && !olderDay ? (
            <>
              <ElapsedTime checkInAt={visit.checkedInAt.toISOString()} asOf={asOf} className={styles.elapsed} />
              <span className={styles.timerTag}>In since {timeLabel(visit.checkedInAt)}</span>
            </>
          ) : state === "open" ? (
            <>
              <span className={styles.older}>Not checked out</span>
              <span className={styles.timerTag}>Open since {formatIsoDate(day)}</span>
            </>
          ) : length !== null ? (
            <>
              <span className={styles.length}>{formatDuration(length)}</span>
              <span className={styles.timerTag}>
                {timeLabel(visit.checkedInAt)} to {when(visit.checkedOutAt!, day)}
              </span>
            </>
          ) : (
            <>
              <span className={styles.unknown}>Left: not recorded</span>
              <span className={styles.timerTag}>In {timeLabel(visit.checkedInAt)} · closed at end of day</span>
            </>
          )}
        </div>
        {state === "open" ? <CheckOutAction visitId={visit.id} name={visit.name} /> : null}
      </Card>

      {visit.lookupOutcome === "PORTAL_UNAVAILABLE" ? (
        <Notice tone="limited" title="Not verified" role="status">
          <p>
            They said they were a client, but the portal could not be reached when they were checked in, so nobody checked
            them against the client records. This visit is logged as a non-client&apos;s: anything they raise is an enquiry.
          </p>
        </Notice>
      ) : null}
      {visit.lookupOutcome === "NO_MATCH" ? (
        <Notice tone="info" role="status">
          <p>
            They said they were a client, but the portal found nobody (or none of the matches was them). Logged as a
            non-client: anything they raise is an enquiry, never a case.
          </p>
        </Notice>
      ) : null}
      {state === "removed" ? (
        <Notice tone="failure" title="This visit was removed" role="status">
          <p>
            It counts for nothing: it is on no list and in no count. Removed at {when(visit.correctedAt!, day)} by{" "}
            {visit.correctedByName ?? "someone"}: “{visit.correctionReason}”. Restore it below if that was a mistake.
          </p>
        </Notice>
      ) : visit.correctedAt !== null ? (
        <p className={styles.correctionNote}>
          <StatusPill tone="steel">Corrected</StatusPill>
          <span>
            Changed at {when(visit.correctedAt, day)} by {visit.correctedByName ?? "someone"}: <q>{visit.correctionReason}</q>
          </span>
        </p>
      ) : null}

      <VisitCorrect
        visitId={visit.id}
        version={visit.version}
        name={visit.name}
        state={state}
        isClient={visit.clientId !== null}
        canChangeType={visit.lookupOutcome === "NOT_LOOKED_UP"}
        current={{
          timeIn: timeLabel(visit.checkedInAt),
          timeOut: state === "closed" ? timeLabel(visit.checkedOutAt!) : null,
          reasonCode: visit.reasonCode,
          typeCode: visit.visitorTypeCode,
          toSee: visit.toSee ?? "",
          name: visit.name,
          phone: visit.phone ? formatPhone(visit.phone) : "",
        }}
      />

      {portal !== null && portal.kind === "loaded" ? <ReleaseBanner position={portal.release} /> : null}
      {portal !== null && portal.kind === "not_found" ? (
        <Notice tone="guidance" title="Client record not found" role="status">
          <p>The portal has no client for this visit any more. The visit itself is kept as logged.</p>
        </Notice>
      ) : null}
      {portal !== null && portal.kind === "rate_limited" ? (
        <Notice tone="limited" title="Client details not loaded" role="status">
          <p>{portal.message} Reload this page to try again. The visit itself is unaffected.</p>
        </Notice>
      ) : null}
      {portal !== null && portal.kind === "failure" ? (
        <Notice tone="failure" title="Client details not loaded" role="alert">
          <p>
            {portal.message}
            {portal.requestId ? ` Reference: ${portal.requestId}.` : ""} The visit itself is unaffected. Release position unknown:
            do not release documents.
          </p>
        </Notice>
      ) : null}

      <HandoverCard
        visitId={visit.id}
        canRecord={visit.clientId !== null && state !== "removed"}
        notClientText={
          visit.clientId !== null
            ? null
            : visit.visitorTypeCode === "CLIENT"
              ? "Documents can only be handed over to a client picked from the portal at check-in. This visit was not verified against the client records, so nothing can be recorded against it. When the portal can find them, check them in as the client and record it there."
              : "Documents can only be handed over to a client. This visitor is not one, so nothing can be recorded against this visit."
        }
        purchases={
          live === null
            ? null
            : live.purchases.map((purchase) => ({
                id: purchase.purchaseId,
                label: `${purchase.label} · ${purchase.estateName}${purchase.status === "ACTIVE" ? "" : ` (${purchase.status.toLowerCase()})`}`,
              }))
        }
        handovers={handoverRows}
      />

      <div className={styles.columns}>
        <Timeline entries={timeline(visit)} />
        <div className={styles.side}>
          <Card as="section" aria-labelledby="about-heading" padding="lg" className={styles.about}>
            <h2 id="about-heading" className={styles.aboutTitle}>
              About the visit
            </h2>
            <dl className={styles.facts}>
              <dt>Lookup</dt>
              <dd>{LOOKUP_TEXT[visit.lookupOutcome]}</dd>
              <dt>Checked in</dt>
              <dd>
                {when(visit.checkedInAt, lagosDateOf(now))} by {visit.checkedInByName ?? "someone"}
              </dd>
              {visit.checkedOutAt !== null ? (
                <>
                  <dt>{visit.closeReason === "AUTO_CLOSED" ? "Closed" : "Checked out"}</dt>
                  <dd>
                    {visit.closeReason === "AUTO_CLOSED"
                      ? `At the end of the day by ${visit.checkedOutByName ?? "someone"}; when they left is unknown`
                      : `${when(visit.checkedOutAt, lagosDateOf(now))} by ${visit.checkedOutByName ?? "someone"}`}
                  </dd>
                </>
              ) : null}
              <dt>Here to see</dt>
              <dd>{visit.toSee ?? "Not recorded"}</dd>
              {visit.clientId === null ? (
                <>
                  <dt>Phone</dt>
                  <dd>{visit.phone ? formatPhone(visit.phone) : "None given"}</dd>
                  <dt>Organisation</dt>
                  <dd>{visit.organisation ?? "None given"}</dd>
                </>
              ) : null}
            </dl>
          </Card>
          {live !== null && portal?.kind === "loaded" ? (
            <>
              <FeePanel summary={live} />
              <DocumentsPanel part={portal.documents} />
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
