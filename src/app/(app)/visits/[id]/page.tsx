// UNVERIFIED AGAINST FIGMA. Screen 05 (nodes 28:2 / 28:80) was built from a
// written description of the frames, not from the frames themselves: the Figma
// MCP quota was spent. See Panels.tsx for what to check.
//
// Decisions that are not in the frame (see CLAUDE.md):
//  - NO phone number and NO "Client ID #GW-00412": neither exists. The meta line
//    is kind, estate and purchase label only.
//  - "Payment status" is retitled "Documentation fee". The portal refuses
//    property balance, last receipt and payment history on purpose; the fee is
//    the only money CSS may show.
//  - "Documents today" is what the portal has ISSUED. It is not a release
//    decision. The release position has its own banner.
//  - The client data is LIVE from the portal; the visit timeline and the
//    check-in time are PLACEHOLDERS (CSS has no visit log yet).
//  - TODO: [id] is a CLIENT id for now. When CSS has a visit store, [id] becomes
//    the visit's id and the client id comes from the visit record.
import type { Metadata } from "next";
import { Avatar } from "@/components/Avatar/Avatar";
import { Card } from "@/components/Card/Card";
import { ElapsedTime } from "@/components/ElapsedTime/ElapsedTime";
import { Notice } from "@/components/Notice/Notice";
import { requireSession } from "@/lib/auth";
import { getVisitDetailSample } from "@/lib/sampleData";
import { loadVisitDetail } from "@/lib/visitDetail";
import { CheckOutAction } from "./CheckOutAction";
import { DocumentsPanel, FeePanel, ReleaseBanner, Timeline } from "./Panels";
import styles from "./page.module.css";

// No client name in the title: it would put client data in the tab and history.
export const metadata: Metadata = {
  title: "Visit — CSS",
};

// Reads the portal per request: never render at build time, never cache.
export const dynamic = "force-dynamic";

export default async function VisitDetailPage({ params }: { params: Promise<{ id: string }> }) {
  // The session first: nothing is asked of the portal for someone who is not in.
  await requireSession();
  const { id } = await params;
  const now = new Date();
  const asOf = now.toISOString();
  const state = await loadVisitDetail(id);

  if (state.kind === "not_found") {
    return (
      <div className={styles.page}>
        <Notice tone="guidance" title="Client not found" role="status">
          <p>{state.message}</p>
        </Notice>
      </div>
    );
  }

  if (state.kind === "rate_limited") {
    return (
      <div className={styles.page}>
        <Notice tone="limited" title="Try again in a moment" role="status">
          <p>{state.message} Reload this page to try again.</p>
        </Notice>
      </div>
    );
  }

  if (state.kind === "failure") {
    return (
      <div className={styles.page}>
        <Notice tone="failure" title="Something is wrong" role="alert">
          <p>
            {state.message}
            {state.requestId ? ` Reference: ${state.requestId}.` : ""}
          </p>
        </Notice>
      </div>
    );
  }

  const { summary, documents, release } = state;
  const sample = getVisitDetailSample(now);
  const [first, ...more] = summary.purchases;
  const meta = ["Client", first?.estateName, first?.label].filter(Boolean).join(" · ") + (more.length > 0 ? ` +${more.length} more` : "");

  return (
    <div className={styles.page}>
      <Card as="section" aria-labelledby="client-name" padding="lg" className={styles.header}>
        <div className={styles.avatar}>
          <Avatar name={summary.displayName} size="responsive" tone="solid" />
        </div>
        <div className={styles.identity}>
          <h1 id="client-name" className={styles.name}>
            {summary.displayName}
          </h1>
          <p className={styles.meta}>{meta}</p>
        </div>
        <div className={styles.timer}>
          <ElapsedTime checkInAt={sample.checkInAt} asOf={asOf} className={styles.elapsed} />
          {/* TODO: the check-in time comes from CSS's visit log, which does not exist. */}
          <span className={styles.sampleTag}>Sample check-in time</span>
        </div>
        <CheckOutAction />
      </Card>

      <ReleaseBanner position={release} />

      <div className={styles.columns}>
        <Timeline entries={sample.entries} />
        <div className={styles.side}>
          <FeePanel summary={summary} />
          <DocumentsPanel part={documents} />
        </div>
      </div>
    </div>
  );
}
