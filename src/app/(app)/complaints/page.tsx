import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/Button/Button";
import { Card } from "@/components/Card/Card";
import { Chip } from "@/components/Chip/Chip";
import { ComplaintAge } from "@/components/ComplaintAge/ComplaintAge";
import { PageHeader } from "@/components/PageHeader/PageHeader";
import { StatusPill } from "@/components/StatusPill/StatusPill";
import { requireSession } from "@/lib/auth";
import { complaintAgeMs, complaintAgeTone } from "@/lib/complaintAge";
import { cx } from "@/lib/cx";
import {
  listCases,
  type CaseChannel,
  type CaseStatus,
  type PortalCase,
} from "@/lib/portal";
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

const UNRESOLVED: CaseStatus[] = ["OPEN", "IN_PROGRESS", "AWAITING_CLIENT"];

function caseTypeText(c: Pick<PortalCase, "typeCode" | "typeLabel">): string {
  return c.typeLabel ?? c.typeCode;
}

type RailTone = "red" | "amber" | "neutral" | "green";

// Unresolved cases: the rail follows the age (the same 24h / 72h rule as the
// dashboard). Resolved is green; withdrawn is neutral.
function railTone(c: PortalCase, nowMs: number): RailTone {
  if (c.status === "RESOLVED") return "green";
  if (c.status === "WITHDRAWN") return "neutral";
  return complaintAgeTone(complaintAgeMs(c.raisedAt, nowMs));
}

// Unresolved first, oldest first (the queue); then the rest, newest first.
function sortCases(cases: PortalCase[]): PortalCase[] {
  const rank = (c: PortalCase) => (UNRESOLVED.includes(c.status) ? 0 : 1);
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
  await requireSession();

  const now = new Date();
  const asOf = now.toISOString();

  const result = await listCases();

  if (!result.ok) {
    const requested = (await searchParams).status;
    const view = VIEWS.find((v) => v.key === requested) ?? VIEWS[0];
    const tabs: StatusTab[] = VIEWS.map((v) => ({
      key: v.key,
      label: v.label,
      count: 0,
      tone: v.tone,
      href: v.key === "open" ? "/complaints" : `/complaints?status=${v.key}`,
      selected: v.key === view.key,
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
        <p className={styles.empty}>{result.error.message}</p>
      </div>
    );
  }

  const cases = result.data.cases;

  const requested = (await searchParams).status;
  const view = VIEWS.find((candidate) => candidate.key === requested) ?? VIEWS[0];
  const showAll = view.statuses === null;
  const visible = sortCases(
    cases.filter((c) => showAll || (view.statuses as readonly CaseStatus[]).includes(c.status)),
  );

  const tabs: StatusTab[] = VIEWS.map((candidate) => ({
    key: candidate.key,
    label: candidate.label,
    count:
      candidate.statuses === null
        ? cases.length
        : cases.filter((c) => (candidate.statuses as readonly CaseStatus[]).includes(c.status)).length,
    tone: candidate.tone,
    href: candidate.key === "open" ? "/complaints" : `/complaints?status=${candidate.key}`,
    selected: candidate.key === view.key,
  }));

  return (
    <div className={styles.page}>
      <div className={styles.titleRow}>
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
        <Button href="/complaints/new" size="compact">+ New complaint</Button>
      </div>

      <StatusTabs tabs={tabs} label="Complaints by status" />

      {visible.length === 0 ? (
        <p className={styles.empty}>No complaints in this view.</p>
      ) : (
        <ul className={styles.list}>
          {visible.map((c) => (
            <li key={c.id}>
              <Card
                as="article"
                plainOnMobile
                className={cx(styles.card, styles[railTone(c, now.getTime())])}
              >
                <span className={styles.rail} aria-hidden="true" />

                <div className={styles.head}>
                  <h2 className={styles.title}>{c.subject}</h2>
                  <div className={styles.chips}>
                    <Chip>{CHANNEL_LABEL[c.channel]}</Chip>
                    {c.escalated ? <StatusPill tone="red">Escalated</StatusPill> : null}
                    {showAll ? (
                      <StatusPill tone={STATUS_PILL[c.status].tone}>
                        {STATUS_PILL[c.status].label}
                      </StatusPill>
                    ) : null}
                  </div>
                </div>

                {c.status === "WITHDRAWN" ? null : c.status === "RESOLVED" ? (
                  <ComplaintAge
                    raisedAt={c.raisedAt}
                    asOf={asOf}
                    until={c.resolvedAt ?? undefined}
                    className={styles.age}
                  />
                ) : (
                  <ComplaintAge raisedAt={c.raisedAt} asOf={asOf} className={styles.age} />
                )}

                <p className={styles.description}>{c.subject}</p>

                <p className={styles.meta}>
                  {c.reference} · {c.recordedBy.role === "CLIENT" ? "Lodged by" : "Logged for"}{" "}
                  {c.clientName} · {caseTypeText(c)}
                </p>

                <div className={styles.action}>
                  <Link href={`/complaints/${c.id}?name=${encodeURIComponent(c.clientName)}`} className={styles.openLink}>Open →</Link>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
