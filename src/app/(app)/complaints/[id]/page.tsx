import type { Metadata } from "next";
import Link from "next/link";
import { Card } from "@/components/Card/Card";
import { Chip } from "@/components/Chip/Chip";
import { ComplaintAge } from "@/components/ComplaintAge/ComplaintAge";
import { Notice } from "@/components/Notice/Notice";
import { PageHeader } from "@/components/PageHeader/PageHeader";
import { StatusPill } from "@/components/StatusPill/StatusPill";
import { requireSession } from "@/lib/auth";
import { loadAssignments } from "@/lib/assignmentStore";
import { isDbError } from "@/lib/db";
import type { CaseAssignmentView } from "@/lib/assignments";
import {
  getCase,
  type CaseChannel,
  type CaseStatus,
  type PortalCaseDetail,
  type PortalCaseEvent,
} from "@/lib/portal";
import { AssignToStaff } from "./AssignToStaff";
import { CaseActions } from "./CaseActions";
import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "Complaint — CSS",
};

export const dynamic = "force-dynamic";

const STATUS_PILL: Record<
  CaseStatus,
  { tone: "green" | "amber" | "red" | "steel" | "neutral"; label: string }
> = {
  OPEN: { tone: "red", label: "Open" },
  IN_PROGRESS: { tone: "amber", label: "In progress" },
  AWAITING_CLIENT: { tone: "steel", label: "Awaiting client" },
  RESOLVED: { tone: "green", label: "Resolved" },
  WITHDRAWN: { tone: "neutral", label: "Withdrawn" },
};

const CHANNEL_LABEL: Record<CaseChannel, string> = {
  PORTAL: "Portal",
  PHONE: "Phone",
  WHATSAPP: "WhatsApp",
  IN_PERSON: "In-person",
  EMAIL: "Email",
};

const EVENT_KIND_LABEL: Record<string, string> = {
  RAISED: "Case opened",
  MESSAGE: "Message",
  STATUS_CHANGE: "Status changed",
  ESCALATED: "Escalated",
  TYPE_CHANGE: "Type changed",
  RESOLVED: "Resolved",
};

function caseTypeText(c: Pick<PortalCaseDetail, "typeCode" | "typeLabel">): string {
  return c.typeLabel ?? c.typeCode;
}

function formatEventTime(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const day = d.toLocaleDateString("en-GB", { timeZone: "Africa/Lagos", day: "numeric", month: "short", year: "numeric" });
  const time = d.toLocaleTimeString("en-GB", { timeZone: "Africa/Lagos", hour: "2-digit", minute: "2-digit", hour12: false });
  return `${day} at ${time}`;
}

function isActionable(status: CaseStatus): boolean {
  return status !== "RESOLVED" && status !== "WITHDRAWN";
}

function EventItem({ event }: { event: PortalCaseEvent }) {
  const label = EVENT_KIND_LABEL[event.kind] ?? event.kind;
  return (
    <li className={styles.event}>
      <span className={styles.eventMeta}>
        <span className={styles.eventType}>{label}</span>
        <span className={styles.eventTime}>{formatEventTime(event.createdAt)}</span>
        <span className={styles.eventBy}>{event.actor.name}</span>
      </span>
      {event.body ? <p className={styles.eventBody}>{event.body}</p> : null}
    </li>
  );
}

export default async function ComplaintDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireSession();
  const { id } = await params;
  const sp = await searchParams;
  const clientName = typeof sp.name === "string" ? sp.name : null;
  const now = new Date();
  const asOf = now.toISOString();

  const caseResult = await getCase(id);

  if (!caseResult.ok) {
    const isNotFound = caseResult.error.kind === "not_found";
    return (
      <div className={styles.page}>
        <PageHeader
          eyebrow={<Link href="/complaints" className={styles.backLink}>← Back to complaints</Link>}
          title={isNotFound ? "Case not found" : "Could not load case"}
        />
        <Notice tone={isNotFound ? "guidance" : "failure"} role="status">
          <p>{caseResult.error.message}</p>
        </Notice>
      </div>
    );
  }

  const c = caseResult.data;
  const pill = STATUS_PILL[c.status];
  const events = [...c.events].sort(
    (a, b) => a.seq - b.seq,
  );

  // CSS's own log of "Assign to staff" (independent of the portal's status). A
  // database read failure here must not hide the complaint, so it degrades.
  let assignments: CaseAssignmentView[] = [];
  let assignmentsFailed = false;
  try {
    assignments = await loadAssignments(c.id);
  } catch (caught) {
    if (isDbError(caught)) assignmentsFailed = true;
    else throw caught;
  }

  const ledeparts = [c.reference];
  if (clientName) ledeparts.push(clientName);
  ledeparts.push(caseTypeText(c));

  return (
    <div className={styles.page}>
      <PageHeader
        eyebrow={<Link href="/complaints" className={styles.backLink}>← Back to complaints</Link>}
        title={c.subject}
        lede={ledeparts.join(" · ")}
      />

      <div className={styles.header}>
        <div className={styles.chips}>
          <StatusPill tone={pill.tone}>{pill.label}</StatusPill>
          <Chip>{CHANNEL_LABEL[c.channel]}</Chip>
          {c.escalated ? <StatusPill tone="red">Escalated</StatusPill> : null}
          <Chip>{c.kind}</Chip>
        </div>
        <div className={styles.age}>
          {c.status === "RESOLVED" && c.resolvedAt ? (
            <ComplaintAge raisedAt={c.raisedAt} asOf={asOf} until={c.resolvedAt} />
          ) : c.status === "WITHDRAWN" ? null : (
            <ComplaintAge raisedAt={c.raisedAt} asOf={asOf} />
          )}
        </div>
      </div>

      {c.description ? (
        <Card className={styles.descriptionCard}>
          <h2 className={styles.sectionTitle}>Description</h2>
          <p className={styles.description}>{c.description}</p>
          {c.status === "RESOLVED" && c.resolutionNote ? (
            <>
              <h3 className={styles.subTitle}>Resolution</h3>
              <p className={styles.description}>{c.resolutionNote}</p>
            </>
          ) : null}
        </Card>
      ) : null}

      {events.length > 0 ? (
        <Card className={styles.timelineCard}>
          <h2 className={styles.sectionTitle}>Timeline</h2>
          <ul className={styles.timeline}>
            {events.map((event) => (
              <EventItem key={event.id} event={event} />
            ))}
          </ul>
        </Card>
      ) : null}

      {isActionable(c.status) ? (
        <Card className={styles.actionsCard}>
          <h2 className={styles.sectionTitle}>Actions</h2>
          <CaseActions
            caseId={c.id}
            version={c.version}
            escalated={c.escalated}
          />
        </Card>
      ) : null}

      <Card className={styles.actionsCard}>
        <h2 className={styles.sectionTitle}>Assign to staff</h2>
        {assignmentsFailed ? (
          <Notice tone="failure" role="status">
            <p>Could not load existing assignments. You can still assign below.</p>
          </Notice>
        ) : assignments.length > 0 ? (
          <ul className={styles.assignments}>
            {assignments.map((a) => (
              <li key={a.id} className={styles.assignment}>
                <span className={styles.assignmentWho}>
                  Assigned to <strong>{a.assigneeName}</strong>
                  {a.priority ? ` · ${a.priority}` : ""}
                </span>
                <span className={styles.assignmentMeta}>
                  {formatEventTime(a.assignedAt.toISOString())}
                  {a.assignedByName ? ` · by ${a.assignedByName}` : ""}
                  {a.taskLink ? (
                    <>
                      {" · "}
                      <a href={a.taskLink} className={styles.backLink} target="_blank" rel="noreferrer">
                        view task →
                      </a>
                    </>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className={styles.description}>Not assigned to anyone yet.</p>
        )}
        <div className={styles.assignAction}>
          <AssignToStaff caseId={c.id} alreadyAssigned={assignments.length > 0} />
        </div>
      </Card>

      <div className={styles.meta}>
        <span>Raised {formatEventTime(c.raisedAt)}</span>
        <span>{c.recordedBy.role === "CLIENT" ? "Lodged by client" : `Logged by ${c.recordedBy.staffName}`}</span>
        {c.purchaseLabel ? <span>Purchase: {c.purchaseLabel}</span> : c.purchaseId ? <span>Purchase: {c.purchaseId}</span> : null}
      </div>
    </div>
  );
}
