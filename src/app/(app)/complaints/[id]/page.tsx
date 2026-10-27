import type { Metadata } from "next";
import Link from "next/link";
import { Card } from "@/components/Card/Card";
import { Chip } from "@/components/Chip/Chip";
import { ComplaintAge } from "@/components/ComplaintAge/ComplaintAge";
import { Notice } from "@/components/Notice/Notice";
import { PageHeader } from "@/components/PageHeader/PageHeader";
import { StatusPill } from "@/components/StatusPill/StatusPill";
import { requireSession } from "@/lib/auth";
import {
  getCase,
  listCaseTypes,
  type CaseChannel,
  type CaseStatus,
  type PortalCaseDetail,
  type PortalCaseEvent,
} from "@/lib/portal";
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

const EVENT_TYPE_LABEL: Record<string, string> = {
  message: "Message",
  status_change: "Status changed",
  escalated: "Escalated",
  type_change: "Type changed",
  created: "Case opened",
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
  const label = EVENT_TYPE_LABEL[event.type] ?? event.type;
  return (
    <li className={styles.event}>
      <span className={styles.eventMeta}>
        <span className={styles.eventType}>{label}</span>
        <span className={styles.eventTime}>{formatEventTime(event.at)}</span>
        <span className={styles.eventBy}>{event.by}</span>
      </span>
      {event.body ? <p className={styles.eventBody}>{event.body}</p> : null}
    </li>
  );
}

export default async function ComplaintDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireSession();
  const { id } = await params;
  const now = new Date();
  const asOf = now.toISOString();

  const [caseResult, typesResult] = await Promise.all([getCase(id), listCaseTypes()]);

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
  const caseTypes = typesResult.ok ? typesResult.data : [];
  const events = [...c.events].sort(
    (a, b) => Date.parse(a.at) - Date.parse(b.at),
  );

  return (
    <div className={styles.page}>
      <PageHeader
        eyebrow={<Link href="/complaints" className={styles.backLink}>← Back to complaints</Link>}
        title={c.subject}
        lede={`${c.referenceNo} · ${c.clientName} · ${caseTypeText(c)}`}
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
            caseTypes={caseTypes}
            currentTypeCode={c.typeCode}
          />
        </Card>
      ) : null}

      <div className={styles.meta}>
        <span>Raised {formatEventTime(c.raisedAt)}</span>
        <span>{c.raisedByRole === "CLIENT" ? "Lodged by client" : "Logged by admin"}</span>
        {c.purchaseId ? <span>Purchase: {c.purchaseId}</span> : null}
        {c.lastClientReplyAt ? <span>Last client reply: {formatEventTime(c.lastClientReplyAt)}</span> : null}
      </div>
    </div>
  );
}
