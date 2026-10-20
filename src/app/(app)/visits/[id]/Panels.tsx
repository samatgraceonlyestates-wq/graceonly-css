// UNVERIFIED AGAINST FIGMA. Screen 05 (nodes 28:2 / 28:80) was built from a
// written description of the frames, not from the frames themselves: the Figma
// MCP quota was spent. Check spacing, type sizes and the wording below (ours,
// not the design's) against the frames before relying on them.
import { Card } from "@/components/Card/Card";
import { Notice } from "@/components/Notice/Notice";
import { StatusPill } from "@/components/StatusPill/StatusPill";
import { FEE_POSITION_PILL, ROLLUP_PILL } from "@/lib/feeRollup";
import { formatIsoDate, formatNaira, timeOfDay } from "@/lib/format";
import type {
  ClientDocuments,
  ClientSummary,
  ReleaseCheckAnswer,
  ReleaseReasonInAnswer,
} from "@/lib/portal";
import { FAILURE_MESSAGE } from "@/lib/portalProblem";
import type { SampleTimelineEntry } from "@/lib/sampleData";
import type { DetailPart, ReleasePosition } from "@/lib/visitDetailState";
import styles from "./Panels.module.css";

// ---------------------------------------------------------------------------
// The release position. THIS MUST NOT BE GOT WRONG.
//
// Today release-check answers 409 GATE_NOT_ACTIVE (the gate is off), which the
// data layer calls gate_off. That, and every case where the check did not
// complete, is "unknown, do not release": the screen says it in words and says
// that nothing else on it is permission. Only a real `checked` answer shows
// per-document allowed / not allowed, read from each document's own `allowed`
// flag. The aggregate flags (gatedDocumentsAllowed, allLiveAllowed) are NOT
// used to say "all clear": the first is vacuously true under a filter, and the
// second is false when nothing is live.
// ---------------------------------------------------------------------------

const REASON_TEXT: Record<ReleaseReasonInAnswer, string> = {
  NO_FEE: "No documentation fee on this purchase",
  PAID: "Documentation fee paid",
  OUTSTANDING: "Documentation fee outstanding",
  UNKNOWN: "Documentation fee position unknown",
  INVALID_TERMS: "Fee terms on record are invalid",
  ENDED: "Purchase has ended",
  NOT_GATED_TYPE: "Not a gated document",
};

function CheckedRelease({ answer }: { answer: ReleaseCheckAnswer }) {
  const { summary } = answer;
  return (
    <Notice tone="info" title="Document gate is switched on" role="status">
      <p>
        {summary.livePurchaseCount === 0
          ? "There are no live purchases, so nothing is cleared for release."
          : `${summary.gatedDocumentsAllowedCount} gated documents allowed and ${summary.gatedDocumentsRefusedCount} refused across ${summary.livePurchaseCount} live purchases. Read each document below; do not assume the rest.`}{" "}
        Checked at {timeOfDay(answer.evaluatedAt)}.
      </p>
      {answer.purchases.map((purchase) => {
        const gated = purchase.byType.filter((entry) => entry.typeIsGated);
        return (
          <div key={purchase.purchaseId} className={styles.releasePurchase}>
            <p className={styles.releaseHeading}>
              {purchase.label} · {purchase.estateName}
            </p>
            {gated.length === 0 ? (
              <p>No gated documents on this purchase.</p>
            ) : (
              <ul className={styles.releaseList}>
                {gated.map((entry) => (
                  <li key={entry.documentType} className={styles.releaseRow}>
                    <span>{entry.label}</span>
                    <StatusPill tone={entry.allowed ? "green" : "red"}>
                      {entry.allowed ? "Allowed" : "Not allowed"}
                    </StatusPill>
                    <span className={styles.releaseReason}>
                      {REASON_TEXT[entry.reason]}
                      {entry.outstandingKobo !== null ? ` · ${formatNaira(entry.outstandingKobo)} outstanding` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
    </Notice>
  );
}

export function ReleaseBanner({ position }: { position: ReleasePosition }) {
  switch (position.kind) {
    case "checked":
      return <CheckedRelease answer={position.answer} />;

    case "gate_off":
      // A NORMAL state today, not a failure, and not an allow.
      return (
        <Notice tone="limited" title="Release position unknown — do not release" role="status">
          <p>{position.message}</p>
          <p>
            <strong>Nothing on this screen means a document may be handed over.</strong> Silence is not permission.
          </p>
        </Notice>
      );

    case "unavailable":
      return (
        <Notice tone="failure" title="Release position could not be checked — do not release" role="alert">
          <p>{position.message}</p>
          <p>
            {position.cause === "rate_limited"
              ? "Too many lookups just now. Reload in a moment to check again."
              : FAILURE_MESSAGE[position.cause]}
            {position.requestId ? ` Reference: ${position.requestId}.` : ""}
          </p>
          <p>
            <strong>Nothing on this screen means a document may be handed over.</strong>
          </p>
        </Notice>
      );
  }
}

// ---------------------------------------------------------------------------
// Documentation fee: the ONLY money CSS may show. The portal refuses property
// balance, last receipt and payment history on purpose (integration design,
// section 7), so none of them appears here and nothing links to them.
// ---------------------------------------------------------------------------

export function FeePanel({ summary }: { summary: ClientSummary }) {
  const rollup = summary.documentationFee;
  const pill = ROLLUP_PILL[rollup.status];

  return (
    <Card as="section" aria-labelledby="fee-heading" padding="lg" className={styles.panel}>
      <div className={styles.panelHeader}>
        <h2 id="fee-heading" className={styles.panelTitle}>
          Documentation fee
        </h2>
        <StatusPill tone={pill.tone}>{pill.label}</StatusPill>
      </div>

      {rollup.outstandingTotalKobo !== null && rollup.outstandingTotalKobo > 0 ? (
        <p className={styles.total}>
          {formatNaira(rollup.outstandingTotalKobo)} outstanding
          {rollup.outstandingTotalIsPartial ? " (known amounts only; some are not known)" : ""}
        </p>
      ) : null}

      {summary.purchases.length === 0 ? (
        <p className={styles.quiet}>No purchases on file.</p>
      ) : (
        <ul className={styles.rows}>
          {summary.purchases.map((purchase) => {
            const fee = purchase.documentationFee;
            const position = FEE_POSITION_PILL[fee.status];
            const amounts: string[] = [];
            if (fee.status === "PAID" || fee.status === "OUTSTANDING") {
              amounts.push(`Owed ${formatNaira(fee.owedKobo)}`, `received ${formatNaira(fee.receivedKobo)}`);
              if (fee.status === "OUTSTANDING") amounts.push(`outstanding ${formatNaira(fee.outstandingKobo)}`);
              if (fee.overpaidKobo > 0) amounts.push(`overpaid ${formatNaira(fee.overpaidKobo)}`);
            }
            return (
              <li key={purchase.purchaseId} className={styles.row}>
                <div className={styles.rowText}>
                  <span className={styles.rowTitle}>
                    {purchase.label} · {purchase.estateName}
                  </span>
                  {amounts.length > 0 ? <span className={styles.rowDetail}>{amounts.join(" · ")}</span> : null}
                </div>
                <StatusPill tone={position.tone}>{position.label}</StatusPill>
              </li>
            );
          })}
        </ul>
      )}

      <p className={styles.quiet}>Other balances and payment history are in the portal, not here.</p>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Documents: what the portal has ISSUED, by type, with the latest date. It is
// NOT a release decision, and the panel says so.
// ---------------------------------------------------------------------------

export function DocumentsPanel({ part }: { part: DetailPart<ClientDocuments> }) {
  return (
    <Card as="section" aria-labelledby="documents-heading" padding="lg" className={styles.panel}>
      <h2 id="documents-heading" className={styles.panelTitle}>
        Documents today
      </h2>
      <p className={styles.quiet}>
        What the portal has issued, by type, with the latest date. This is not a release decision.
      </p>

      {part.status === "rate_limited" ? (
        <Notice tone="limited" title="Documents not loaded" role="status">
          <p>Too many lookups just now. Reload in a moment. The rest of this screen is unaffected.</p>
        </Notice>
      ) : null}

      {part.status === "failed" ? (
        <Notice tone="failure" title="Documents not loaded" role="alert">
          <p>
            {part.message}
            {part.requestId ? ` Reference: ${part.requestId}.` : ""}
          </p>
        </Notice>
      ) : null}

      {part.status === "ok" ? <DocumentsList documents={part.data} /> : null}
    </Card>
  );
}

function DocumentsList({ documents }: { documents: ClientDocuments }) {
  return (
    <>
      {documents.purchases.length === 0 && documents.unattached.length === 0 ? (
        <p className={styles.quiet}>Nothing issued yet.</p>
      ) : null}

      {documents.purchases.map((purchase) => {
        const issued = purchase.documents.filter((slot) => slot.issued);
        return (
          <div key={purchase.purchaseId} className={styles.docGroup}>
            <p className={styles.docHeading}>
              {purchase.label} · {purchase.estateName}
            </p>
            {issued.length === 0 && !purchase.other ? (
              <p className={styles.quiet}>Nothing issued yet.</p>
            ) : (
              <ul className={styles.rows}>
                {issued.map((slot) => (
                  <li key={slot.type} className={styles.docRow}>
                    <span className={styles.rowTitle}>{slot.label}</span>
                    <span className={styles.rowDetail}>
                      {slot.count} issued{slot.latestIssuedOn ? ` · latest ${formatIsoDate(slot.latestIssuedOn)}` : ""}
                    </span>
                  </li>
                ))}
                {purchase.other ? (
                  <li className={styles.docRow}>
                    <span className={styles.rowTitle}>Other</span>
                    <span className={styles.rowDetail}>
                      {purchase.other.count} issued · latest {formatIsoDate(purchase.other.latestIssuedOn)}
                    </span>
                  </li>
                ) : null}
              </ul>
            )}
          </div>
        );
      })}

      {documents.unattached.length > 0 ? (
        <div className={styles.docGroup}>
          <p className={styles.docHeading}>Held for the client, attached to no purchase</p>
          <p className={styles.quiet}>
            These are outside the release gate: it works per purchase and does not cover them. Do not assume they
            are cleared.
          </p>
          <ul className={styles.rows}>
            {documents.unattached.map((entry) => (
              <li key={entry.type} className={styles.docRow}>
                <span className={styles.rowTitle}>{entry.label}</span>
                <span className={styles.rowDetail}>
                  {entry.count} held · latest {formatIsoDate(entry.latestIssuedOn)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------------------
// The visit timeline is CSS's OWN visit log, which does not exist yet. These
// entries are placeholders from sampleData.ts and say so on their face.
// TODO: read the real log when the visit store exists.
// ---------------------------------------------------------------------------

export function Timeline({ entries }: { entries: SampleTimelineEntry[] }) {
  return (
    <Card as="section" aria-labelledby="timeline-heading" padding="lg" className={styles.panel}>
      <div className={styles.panelHeader}>
        <h2 id="timeline-heading" className={styles.panelTitle}>
          Visit timeline
        </h2>
        <StatusPill tone="neutral">Sample</StatusPill>
      </div>
      <p className={styles.quiet}>
        Placeholder entries: CSS has no visit log yet, so these are not this visitor’s real timeline.
      </p>
      <ol className={styles.timeline}>
        {entries.map((entry) => (
          <li key={entry.id} className={styles.entry}>
            <div className={styles.rowText}>
              <span className={styles.rowTitle}>{entry.title}</span>
              <span className={styles.rowDetail}>{entry.detail}</span>
            </div>
            <time className={styles.entryTime} dateTime={entry.at}>
              {timeOfDay(entry.at)}
            </time>
          </li>
        ))}
      </ol>
    </Card>
  );
}
