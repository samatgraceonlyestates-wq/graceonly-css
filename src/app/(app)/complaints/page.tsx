import type { Metadata } from "next";
import { Button } from "@/components/Button/Button";
import { Card } from "@/components/Card/Card";
import { Chip } from "@/components/Chip/Chip";
import { ComplaintAge } from "@/components/ComplaintAge/ComplaintAge";
import { PageHeader } from "@/components/PageHeader/PageHeader";
import { StatusPill } from "@/components/StatusPill/StatusPill";
import { complaintAgeMs, complaintAgeTone } from "@/lib/complaintAge";
import { cx } from "@/lib/cx";
import {
  disputeTypeText,
  getComplaintsSample,
  type DisputeChannel,
  type DisputeStatus,
  type SampleDispute,
} from "@/lib/sampleData";
import { StatusTabs, type StatusTab } from "./StatusTabs";
import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "Complaints — CSS",
};

// Live front-desk state: render per request, never at build time.
export const dynamic = "force-dynamic";

// The portal's real statuses, not the mockup's three. WITHDRAWN appears only
// under "All", with its own pill.
const VIEWS = [
  { key: "open", label: "Open", statuses: ["OPEN"], tone: "red" },
  { key: "in-progress", label: "In progress", statuses: ["IN_PROGRESS"], tone: "amber" },
  { key: "awaiting-client", label: "Awaiting client", statuses: ["AWAITING_CLIENT"], tone: "steel" },
  { key: "resolved", label: "Resolved", statuses: ["RESOLVED"], tone: "green" },
  { key: "all", label: "All", statuses: null, tone: "neutral" },
] as const;

const STATUS_PILL: Record<
  DisputeStatus,
  { tone: "green" | "amber" | "red" | "steel" | "neutral"; label: string }
> = {
  OPEN: { tone: "red", label: "Open" },
  IN_PROGRESS: { tone: "amber", label: "In progress" },
  AWAITING_CLIENT: { tone: "steel", label: "Awaiting client" },
  RESOLVED: { tone: "green", label: "Resolved" },
  WITHDRAWN: { tone: "neutral", label: "Withdrawn" },
};

const CHANNEL_LABEL: Record<DisputeChannel, string> = {
  PORTAL: "Portal",
  PHONE: "Phone",
  WHATSAPP: "WhatsApp",
  IN_PERSON: "In-person",
  EMAIL: "Email",
};

const UNRESOLVED: DisputeStatus[] = ["OPEN", "IN_PROGRESS", "AWAITING_CLIENT"];

type RailTone = "red" | "amber" | "neutral" | "green";

// Unresolved cases: the rail follows the age (the same 24h / 72h rule as the
// dashboard). Resolved is green; withdrawn is neutral.
function railTone(dispute: SampleDispute, nowMs: number): RailTone {
  if (dispute.status === "RESOLVED") return "green";
  if (dispute.status === "WITHDRAWN") return "neutral";
  return complaintAgeTone(complaintAgeMs(dispute.raisedAt, nowMs));
}

// Unresolved first, oldest first (the queue); then the rest, newest first.
function sortCases(cases: SampleDispute[]): SampleDispute[] {
  const rank = (dispute: SampleDispute) => (UNRESOLVED.includes(dispute.status) ? 0 : 1);
  return [...cases].sort((a, b) => {
    if (rank(a) !== rank(b)) return rank(a) - rank(b);
    const diff = Date.parse(a.raisedAt) - Date.parse(b.raisedAt);
    return rank(a) === 0 ? diff : -diff;
  });
}

export default async function ComplaintsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  // TODO: THE PORTAL READ BELONGS HERE (see getComplaintsSample). NONE of the
  // case endpoints are built yet: only the five read-only client endpoints
  // exist, so this reads sample rows shaped like the portal's `disputes` row.
  const now = new Date();
  const asOf = now.toISOString();
  const cases = getComplaintsSample(now);

  const requested = (await searchParams).status;
  const view = VIEWS.find((candidate) => candidate.key === requested) ?? VIEWS[0];
  const showAll = view.statuses === null;
  const visible = sortCases(
    cases.filter((dispute) => showAll || (view.statuses as readonly DisputeStatus[]).includes(dispute.status)),
  );

  const tabs: StatusTab[] = VIEWS.map((candidate) => ({
    key: candidate.key,
    label: candidate.label,
    count:
      candidate.statuses === null
        ? cases.length
        : cases.filter((dispute) => (candidate.statuses as readonly DisputeStatus[]).includes(dispute.status)).length,
    tone: candidate.tone,
    href: candidate.key === "open" ? "/complaints" : `/complaints?status=${candidate.key}`,
    selected: candidate.key === view.key,
  }));

  return (
    <div className={styles.page}>
      <PageHeader
        eyebrow={
          <>
            <span className={styles.desktopInline}>Admin · Care · Complaints</span>
            <span className={styles.mobileInline}>Admin · Care</span>
          </>
        }
        title={
          <>
            <span className={styles.desktopInline}>Complaint queue</span>
            <span className={styles.mobileInline}>Complaints</span>
          </>
        }
      />

      <StatusTabs tabs={tabs} label="Complaints by status" />

      {visible.length === 0 ? (
        <p className={styles.empty}>No complaints in this view.</p>
      ) : (
        <ul className={styles.list}>
          {visible.map((dispute) => (
            <li key={dispute.id}>
              <Card
                as="article"
                plainOnMobile
                className={cx(styles.card, styles[railTone(dispute, now.getTime())])}
              >
                <span className={styles.rail} aria-hidden="true" />

                <div className={styles.head}>
                  <h2 className={styles.title}>{dispute.subject}</h2>
                  <div className={styles.chips}>
                    <Chip>{CHANNEL_LABEL[dispute.channel]}</Chip>
                    {dispute.escalated ? <StatusPill tone="red">Escalated</StatusPill> : null}
                    {showAll ? (
                      <StatusPill tone={STATUS_PILL[dispute.status].tone}>
                        {STATUS_PILL[dispute.status].label}
                      </StatusPill>
                    ) : null}
                  </div>
                </div>

                {dispute.status === "WITHDRAWN" ? null : dispute.status === "RESOLVED" ? (
                  <ComplaintAge
                    raisedAt={dispute.raisedAt}
                    asOf={asOf}
                    until={dispute.resolvedAt ?? undefined}
                    className={styles.age}
                  />
                ) : (
                  <ComplaintAge raisedAt={dispute.raisedAt} asOf={asOf} className={styles.age} />
                )}

                <p className={styles.description}>
                  {dispute.description}
                  {dispute.status === "RESOLVED" && dispute.resolutionNote
                    ? ` Resolution: ${dispute.resolutionNote}`
                    : ""}
                </p>

                <p className={styles.meta}>
                  {dispute.referenceNo} · {dispute.raisedByRole === "CLIENT" ? "Lodged by" : "Logged for"}{" "}
                  {dispute.clientName} · {disputeTypeText(dispute)}
                </p>

                <div className={styles.action}>
                  {/* TODO: "Open →" is wired to nothing. It needs (1) the complaint
                      detail screen, which is not among the eight and not yet
                      designed, and (2) POST /support-cases/{id}/actions, where a
                      resolution note and the row's `version` (compare-and-set) are
                      sent to the PORTAL. There is deliberately no one-click
                      "Mark resolved" in this list: it would be a lie without both. */}
                  <Button variant="row-action">Open →</Button>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
