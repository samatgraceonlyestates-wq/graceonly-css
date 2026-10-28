import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/PageHeader/PageHeader";
import { Card } from "@/components/Card/Card";
import { StatusPill } from "@/components/StatusPill/StatusPill";
import { requireAnyRole } from "@/lib/auth";
import { timeLabel } from "@/lib/departureTime";
import { formatIsoDate } from "@/lib/format";
import { HANDOVER_DOCUMENTS, HANDOVER_ROLES, GATE_ANSWER_TEXT } from "@/lib/handovers";
import { lagosDateOf } from "@/lib/lagosTime";
import { loadHandoverHistory } from "@/lib/handoverStore";
import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "Handover history — CSS",
};

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

export default async function HandoverHistoryPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { allowed } = await requireAnyRole(HANDOVER_ROLES);
  if (!allowed) {
    return (
      <div>
        <PageHeader title="Handover history" lede="You do not have permission to view this page." />
      </div>
    );
  }

  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const search = typeof sp.q === "string" ? sp.q : undefined;
  const offset = (page - 1) * PAGE_SIZE;

  const { rows, total } = await loadHandoverHistory({ limit: PAGE_SIZE, offset, search });
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div>
      <PageHeader
        eyebrow={<Link href="/documents" style={{ color: "var(--fold-gold)", fontSize: "13px", fontWeight: 500, textDecoration: "none" }}>← Back to documents</Link>}
        title="Handover history"
        lede={`${total} record${total === 1 ? "" : "s"} across all clients.`}
      />

      <Card className={styles.card}>
        <form method="get" className={styles.searchRow}>
          <input
            type="text"
            name="q"
            defaultValue={search ?? ""}
            placeholder="Search by client name..."
            className={styles.input}
            autoComplete="off"
          />
          <button type="submit" className={styles.searchButton}>Search</button>
        </form>

        {rows.length === 0 ? (
          <p className={styles.empty}>No handover records found.</p>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th className={styles.th}>Date / Time</th>
                  <th className={styles.th}>Client</th>
                  <th className={styles.th}>Documents</th>
                  <th className={styles.th}>Released by</th>
                  <th className={styles.th}>Gate</th>
                  <th className={styles.th}>Portal sync</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const gate = GATE_ANSWER_TEXT[row.gateAnswer];
                  const withdrawn = row.withdrawnAt !== null;
                  return (
                    <tr key={row.id} className={withdrawn ? styles.withdrawn : undefined}>
                      <td className={styles.td}>
                        <Link href={`/visits/${row.visitId}`} className={styles.link}>
                          {formatIsoDate(lagosDateOf(row.releasedAt))} {timeLabel(row.releasedAt)}
                        </Link>
                      </td>
                      <td className={styles.td}>{row.clientName ?? "Unknown"}</td>
                      <td className={styles.td}>
                        {row.items.map((item) => `${item.label} ×${item.quantity}`).join(", ")}
                      </td>
                      <td className={styles.td}>{row.releasedByName ?? "—"}</td>
                      <td className={styles.td}>
                        <StatusPill tone={gate.tone}>{gate.pill}</StatusPill>
                        {withdrawn ? <StatusPill tone="steel">Withdrawn</StatusPill> : null}
                      </td>
                      <td className={styles.td}>
                        {row.portalReleaseId ? (
                          <StatusPill tone="green">Synced</StatusPill>
                        ) : row.lastError ? (
                          <StatusPill tone="amber">Not synced</StatusPill>
                        ) : (
                          <span className={styles.muted}>—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {totalPages > 1 ? (
          <div className={styles.pagination}>
            {page > 1 ? (
              <Link href={`/documents/history?page=${page - 1}${search ? `&q=${encodeURIComponent(search)}` : ""}`} className={styles.pageLink}>
                ← Previous
              </Link>
            ) : null}
            <span className={styles.pageInfo}>Page {page} of {totalPages}</span>
            {page < totalPages ? (
              <Link href={`/documents/history?page=${page + 1}${search ? `&q=${encodeURIComponent(search)}` : ""}`} className={styles.pageLink}>
                Next →
              </Link>
            ) : null}
          </div>
        ) : null}
      </Card>
    </div>
  );
}
